import path from 'node:path';
import { lstat, readdir, mkdir, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as koffi from 'koffi';
import type { FileNode, Storage, ErrorCode } from '../../shared/contracts';
import type {
  NativeResult,
  NativeDeviceInfo,
  NativeTransferOptions,
  TransferProgress,
} from './types';
import {
  LibmtpBindings,
  DeviceHeader,
  RawDevice,
  StorageStruct,
  FileStruct,
  ErrorStruct,
  ProgressCallback,
  type NativeFile,
  type NativeStorage,
  type Address,
} from './libmtp-bindings';
const ROOT = 0xffffffff;
const UNKNOWN_FILETYPE = 44;
class CoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
interface ObjectEntry extends FileNode {
  id: number;
  parent: number;
}
interface PlannedFile {
  source: string;
  destination: string;
  size: number;
  directory: boolean;
  object?: number;
}
export class Libmtp {
  private api: LibmtpBindings;
  private device: Address = null;
  private active = false;
  private directories = new Map<string, number>();
  constructor(library: string) {
    this.api = new LibmtpBindings(library);
  }
  private result<T>(error: unknown): NativeResult<T> {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
      code: error instanceof CoreError ? error.code : 'IO_ERROR',
    };
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<NativeResult<T>> {
    if (this.active) return this.result(new CoreError('BUSY', 'An MTP operation is active'));
    this.active = true;
    // Object IDs may change when files are moved on the phone between operations.
    this.directories.clear();
    try {
      return { data: await operation() };
    } catch (error) {
      return this.result(error);
    } finally {
      this.active = false;
    }
  }
  private connected(): bigint {
    if (!this.device) throw new CoreError('NO_DEVICE', 'No Android device is connected');
    return this.device;
  }
  private clear() {
    this.api.sync('clearErrors', this.connected());
  }
  private diagnostic(fallback: string): CoreError {
    let pointer = this.api.sync<Address>('errors', this.connected());
    const messages: string[] = [];
    while (pointer) {
      const value = this.api.decode<{ error_text: Address; next: Address }>(pointer, ErrorStruct);
      messages.push(this.api.text(value.error_text));
      pointer = value.next;
    }
    this.api.sync('clearErrors', this.connected());
    return new CoreError('IO_ERROR', messages.filter(Boolean).join('; ') || fallback);
  }
  private hasError(): boolean {
    return !!this.api.sync<Address>('errors', this.connected());
  }
  private async ownedString(operation: 'manufacturer' | 'model' | 'serial'): Promise<string> {
    const pointer = await this.api.call<Address>(operation, this.connected());
    try {
      return this.api.text(pointer);
    } finally {
      if (pointer) this.api.sync('free', pointer);
    }
  }
  async initialize(): Promise<NativeResult<NativeDeviceInfo>> {
    return this.exclusive(async () => {
      if (this.device) {
        await this.api.call('release', this.device);
        this.device = null;
      }
      this.directories.clear();
      const devices: Address[] = [null],
        count = [0];
      let status = 5;
      const deadline = Date.now() + 3000;
      do {
        status = await this.api.call<number>('detect', devices, count);
        if (status !== 5 || Date.now() >= deadline) break;
        if (devices[0]) this.api.sync('free', devices[0]);
        devices[0] = null;
        count[0] = 0;
        // Some Android devices re-enumerate after libmtp closes the USB session.
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (true);
      try {
        if (status !== 0 || !devices[0] || !count[0])
          throw new CoreError(
            status === 5 ? 'NO_DEVICE' : 'IO_ERROR',
            `MTP device detection failed (${status})`,
          );
        // One session owns one USB device; storage selection remains in the existing UI.
        this.device = await this.api.call<Address>('open', devices[0]);
        if (!this.device)
          throw new CoreError(
            'IO_ERROR',
            'Cannot open Android MTP interface; unlock the phone and close other transfer apps',
          );
        try {
          const manufacturer = await this.ownedString('manufacturer');
          const name = (await this.ownedString('model')) || manufacturer || 'Android';
          const serial = await this.ownedString('serial');
          return { name, manufacturer, serial };
        } catch (error) {
          await this.api.call('release', this.device);
          this.device = null;
          throw error;
        }
      } finally {
        if (devices[0]) this.api.sync('free', devices[0]);
      }
    });
  }
  async dispose(): Promise<NativeResult<boolean>> {
    return this.exclusive(async () => {
      if (this.device) {
        await this.api.call('release', this.device);
        this.device = null;
      }
      this.directories.clear();
      return true;
    });
  }
  async listStorages(): Promise<NativeResult<Storage[]>> {
    return this.exclusive(async () => {
      this.clear();
      if ((await this.api.call<number>('storage', this.connected(), 0)) !== 0)
        throw this.diagnostic('Cannot read Android storage');
      let pointer = this.api.decode<{ storage: Address }>(this.connected(), DeviceHeader).storage;
      const result: Storage[] = [];
      while (pointer) {
        const value = this.api.decode<NativeStorage>(pointer, StorageStruct);
        result.push({
          id: value.id,
          name: this.api.text(value.StorageDescription) || 'Android storage',
          capacity: Number(value.MaxCapacity),
          available: Number(value.FreeSpaceInBytes),
        });
        pointer = value.next;
      }
      if (!result.length)
        throw new CoreError('DEVICE_LOCKED', 'No accessible storage; unlock the Android device');
      return result;
    });
  }
  private key(storage: number, directory: string) {
    return `${storage}:${path.posix.resolve('/', directory)}`;
  }
  private safeName(name: string) {
    if (!name || name === '.' || name === '..' || /[\/\\\0]/.test(name))
      throw new CoreError('INVALID_PATH', 'Unsafe file name returned by device');
    return name;
  }
  private async list(storage: number, parent: number, directory: string): Promise<ObjectEntry[]> {
    this.clear();
    let pointer = await this.api.call<Address>('list', this.connected(), storage, parent);
    if (!pointer && this.hasError()) throw this.diagnostic('Cannot list Android directory');
    const files: ObjectEntry[] = [];
    try {
      while (pointer) {
        const owned = pointer;
        const value = this.api.decode<NativeFile>(owned, FileStruct);
        pointer = value.next;
        try {
          const name = this.safeName(this.api.text(value.filename));
          const fullPath = path.posix.join(directory, name);
          const isFolder = value.filetype === 0;
          files.push({
            id: value.item_id,
            parent: value.parent_id,
            name,
            path: fullPath,
            isFolder,
            size: isFolder ? null : Number(value.filesize),
            dateAdded: Number(value.modificationdate) * 1000,
          });
          if (isFolder) this.directories.set(this.key(storage, fullPath), value.item_id);
        } finally {
          this.api.sync('destroyFile', owned);
        }
      }
    } finally {
      while (pointer) {
        const owned = pointer;
        pointer = this.api.decode<NativeFile>(owned, FileStruct).next;
        this.api.sync('destroyFile', owned);
      }
    }
    return files;
  }
  private async folder(storage: number, directory: string): Promise<number> {
    const normalized = path.posix.resolve('/', directory);
    if (normalized === '/') return ROOT;
    const cached = this.directories.get(this.key(storage, normalized));
    if (cached !== undefined) return cached;
    const parentPath = path.posix.dirname(normalized);
    const parent = await this.folder(storage, parentPath);
    const entry = (await this.list(storage, parent, parentPath)).find(
      (file) => file.path === normalized,
    );
    if (!entry?.isFolder)
      throw new CoreError('NOT_FOUND', 'Android folder does not exist: ' + normalized);
    return entry.id;
  }
  private async object(storage: number, fullPath: string): Promise<ObjectEntry> {
    const normalized = path.posix.resolve('/', fullPath);
    if (normalized === '/') throw new CoreError('INVALID_PATH', 'Cannot mutate a storage root');
    const directory = path.posix.dirname(normalized),
      parent = await this.folder(storage, directory);
    const value = (await this.list(storage, parent, directory)).find(
      (file) => file.path === normalized,
    );
    if (!value) throw new CoreError('NOT_FOUND', 'Android path does not exist: ' + normalized);
    return value;
  }
  async walk({
    storageId,
    fullPath,
    skipHiddenFiles,
  }: {
    storageId: number;
    fullPath: string;
    skipHiddenFiles: boolean;
  }): Promise<NativeResult<FileNode[]>> {
    return this.exclusive(async () => {
      const directory = path.posix.resolve('/', fullPath);
      const parent = await this.folder(storageId, directory);
      return (await this.list(storageId, parent, directory))
        .filter((file) => !skipHiddenFiles || !file.name.startsWith('.'))
        .map(({ id, parent, ...file }) => file);
    });
  }
  private async ensureFolder(storage: number, fullPath: string): Promise<number> {
    const directory = path.posix.resolve('/', fullPath);
    if (directory === '/') return ROOT;
    const parentPath = path.posix.dirname(directory),
      parent = await this.folder(storage, parentPath);
    const name = this.safeName(path.posix.basename(directory));
    const existing = (await this.list(storage, parent, parentPath)).find(
      (file) => file.name === name,
    );
    if (existing) {
      if (!existing.isFolder)
        throw new CoreError('INVALID_PATH', 'A file occupies the destination folder');
      return existing.id;
    }
    this.clear();
    const id = await this.api.call<number>('mkdir', this.connected(), name, parent, storage);
    if (!id) throw this.diagnostic('Cannot create Android folder');
    this.directories.set(this.key(storage, directory), id);
    return id;
  }
  async makeDirectory({
    storageId,
    fullPath,
  }: {
    storageId: number;
    fullPath: string;
  }): Promise<NativeResult<boolean>> {
    return this.exclusive(async () => {
      await this.ensureFolder(storageId, fullPath);
      return true;
    });
  }
  async renameFile({
    storageId,
    fullPath,
    newFilename,
  }: {
    storageId: number;
    fullPath: string;
    newFilename: string;
  }): Promise<NativeResult<boolean>> {
    return this.exclusive(async () => {
      this.safeName(newFilename);
      const entry = await this.object(storageId, fullPath);
      this.clear();
      const file = await this.api.call<Address>('metadata', this.connected(), entry.id);
      if (!file) throw this.diagnostic('Cannot read object metadata');
      try {
        if ((await this.api.call<number>('rename', this.connected(), file, newFilename)) !== 0)
          throw this.diagnostic('Cannot rename Android object');
      } finally {
        this.api.sync('destroyFile', file);
      }
      this.directories.clear();
      return true;
    });
  }
  async deleteFile({
    storageId,
    files,
  }: {
    storageId: number;
    files: string[];
  }): Promise<NativeResult<boolean>> {
    return this.exclusive(async () => {
      const remove = async (entry: ObjectEntry): Promise<void> => {
        if (entry.isFolder)
          for (const child of await this.list(storageId, entry.id, entry.path)) await remove(child);
        this.clear();
        if ((await this.api.call<number>('delete', this.connected(), entry.id)) !== 0)
          throw this.diagnostic('Cannot delete Android object');
      };
      try {
        for (const file of files) await remove(await this.object(storageId, file));
        return true;
      } finally {
        this.directories.clear();
      }
    });
  }
  private async plan(options: NativeTransferOptions): Promise<PlannedFile[]> {
    const files: PlannedFile[] = [];
    if (options.direction === 'upload') {
      const visit = async (source: string, destination: string) => {
        const info = await lstat(source);
        if (info.isSymbolicLink()) return;
        if (!info.isDirectory() && !info.isFile())
          throw new CoreError('INVALID_PATH', 'Only regular files and folders can be uploaded');
        files.push({ source, destination, size: info.size, directory: info.isDirectory() });
        if (info.isDirectory())
          for (const name of await readdir(source)) {
            this.safeName(name);
            await visit(path.join(source, name), path.posix.join(destination, name));
          }
      };
      await this.folder(options.storageId, options.destination);
      for (const source of options.sources)
        await visit(
          source,
          path.posix.join(options.destination, this.safeName(path.basename(source))),
        );
    } else {
      const visit = async (entry: ObjectEntry, destination: string) => {
        files.push({
          source: entry.path,
          destination,
          size: entry.size ?? 0,
          directory: entry.isFolder,
          object: entry.id,
        });
        if (entry.isFolder)
          for (const child of await this.list(options.storageId, entry.id, entry.path))
            await visit(child, path.join(destination, this.safeName(child.name)));
      };
      for (const source of options.sources) {
        const entry = await this.object(options.storageId, source);
        await visit(entry, path.join(options.destination, this.safeName(entry.name)));
      }
    }
    return files;
  }
  async transferFiles(options: NativeTransferOptions): Promise<NativeResult<unknown>> {
    const result = await this.exclusive(async () => {
      const started = Date.now();
      const files = await this.plan(options);
      const total = files.reduce((sum, file) => sum + (file.directory ? 0 : file.size), 0);
      let sent = 0,
        completed = 0,
        last = 0;
      const fileCount = files.filter((file) => !file.directory).length;
      const progress = (file: PlannedFile, bytes: number, force = false) => {
        const now = Date.now();
        if (!force && now - last < 100) return;
        last = now;
        const elapsed = now - started;
        const bulkSent = sent + Math.min(file.size, bytes);
        const event: TransferProgress = {
          fullPath: file.source,
          name: path.basename(file.source),
          elapsedTime: elapsed,
          speed: elapsed ? bulkSent / 1048576 / (elapsed / 1000) : 0,
          totalFiles: fileCount,
          totalDirectories: files.length - fileCount,
          filesSent: completed,
          filesSentProgress: fileCount ? (completed / fileCount) * 100 : 100,
          activeFileSize: {
            total: file.size,
            sent: bytes,
            progress: file.size ? (bytes / file.size) * 100 : 100,
          },
          bulkFileSize: { total, sent: bulkSent, progress: total ? (bulkSent / total) * 100 : 100 },
          status: 'running',
        };
        options.onProgress(event);
      };
      for (const file of files) {
        options.onPreprocess({
          fullPath: file.source,
          name: path.basename(file.source),
          size: file.directory ? 0 : file.size,
        });
        if (file.directory) {
          if (options.direction === 'upload')
            await this.ensureFolder(options.storageId, file.destination);
          else {
            await mkdir(file.destination, { recursive: true });
            if ((await lstat(file.destination)).isSymbolicLink())
              throw new CoreError('INVALID_PATH', 'Download folder is a symbolic link');
          }
          continue;
        }
        let callbackError: unknown;
        const callback = koffi.register((bytes: number | bigint) => {
          try {
            progress(file, Number(bytes));
            return 0;
          } catch (error) {
            callbackError = error;
            return 1;
          }
        }, koffi.pointer(ProgressCallback));
        try {
          this.clear();
          if (options.direction === 'upload') {
            const parent = await this.folder(
              options.storageId,
              path.posix.dirname(file.destination),
            );
            const metadata = this.api.sync<Address>('newFile');
            if (!metadata) throw new CoreError('IO_ERROR', 'Cannot allocate upload metadata');
            try {
              const filename = this.api.strdup(
                this.safeName(path.posix.basename(file.destination)),
              );
              if (!filename) throw new CoreError('IO_ERROR', 'Cannot allocate upload filename');
              koffi.encode(metadata, FileStruct, {
                item_id: 0,
                parent_id: parent,
                storage_id: options.storageId,
                filename,
                filesize: file.size,
                modificationdate: 0,
                filetype: UNKNOWN_FILETYPE,
                next: null,
              });
              if (
                (await this.api.call<number>(
                  'upload',
                  this.connected(),
                  file.source,
                  metadata,
                  callback,
                  null,
                )) !== 0
              )
                throw callbackError ?? this.diagnostic('Upload failed');
            } finally {
              this.api.sync('destroyFile', metadata);
            }
          } else {
            // Publish only a complete download. A failed transfer cannot truncate an existing file.
            const temporary = path.join(
              path.dirname(file.destination),
              `.relay-${randomUUID()}.partial`,
            );
            const handle = await open(temporary, 'wx', 0o600);
            try {
              if (
                (await this.api.call<number>(
                  'download',
                  this.connected(),
                  file.object,
                  handle.fd,
                  callback,
                  null,
                )) !== 0
              )
                throw callbackError ?? this.diagnostic('Download failed');
              await handle.sync();
              await handle.close();
              await rename(temporary, file.destination);
            } finally {
              await handle.close().catch(() => {});
              await rm(temporary, { force: true });
            }
          }
          progress(file, file.size, true);
          sent += file.size;
          completed++;
        } finally {
          koffi.unregister(callback);
        }
      }
      return true;
    });
    if (result.error || result.code) options.onError(result);
    else options.onCompleted();
    return result;
  }
}
