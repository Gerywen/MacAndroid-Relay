import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { stat, lstat, readdir } from 'node:fs/promises';
import type {
  Connection,
  Directory,
  Mutation,
  TransferRequest,
  TransferUpdate,
} from '../shared/contracts';
import { Libmtp } from './native/Libmtp';
import type { NativeResult } from './native/types';
import { AppError, failure, filename, string } from './errors';
function unwrap<T>(result: NativeResult<T>): T {
  if (result.error || result.code || result.data === null) {
    throw new AppError(
      result.code ?? 'IO_ERROR',
      String(result.error ?? 'MTP operation returned no data'),
    );
  }
  return result.data;
}
// Treat an empty listing consistently at the application boundary.
function entries<T>(result: NativeResult<T[]>): T[] {
  return unwrap({ ...result, data: result.data ?? [] });
}
export type MtpCore = Pick<
  Libmtp,
  | 'initialize'
  | 'dispose'
  | 'listStorages'
  | 'walk'
  | 'makeDirectory'
  | 'renameFile'
  | 'deleteFile'
  | 'transferFiles'
>;
export class DeviceSession {
  private core?: MtpCore;
  private state: Connection = { connected: false, name: 'Android', storages: [] };
  private busy = false;
  constructor(
    private library: string,
    private factory: (file: string) => MtpCore = (file) => new Libmtp(file),
    private platform: NodeJS.Platform = process.platform,
  ) {}
  get active() {
    return this.busy;
  }
  private sdk() {
    if (this.platform !== 'darwin')
      throw new AppError('UNSUPPORTED', 'The bundled MTP core currently supports macOS');
    return (this.core ??= this.factory(this.library));
  }
  private available(storageId: number | null) {
    if (this.busy) throw new AppError('BUSY', 'A transfer is active');
    if (
      !this.state.connected ||
      storageId === null ||
      !this.state.storages.some((storage) => storage.id === storageId)
    )
      throw new AppError('NO_DEVICE', 'Connect an Android device and select a storage');
    return storageId;
  }
  async connect(): Promise<Connection> {
    if (this.busy) throw new AppError('BUSY', 'A transfer is active');
    if (this.core) await this.core.dispose();
    this.state = { connected: false, name: 'Android', storages: [] };
    const core = this.sdk();
    const info = unwrap(await core.initialize());
    try {
      const storages = unwrap(await core.listStorages());
      this.state = {
        connected: true,
        name: info.name || info.manufacturer || 'Android',
        storages,
      };
      return this.state;
    } catch (error) {
      await core.dispose();
      throw error;
    }
  }
  async disconnect() {
    if (this.busy) throw new AppError('BUSY', 'A transfer is active');
    if (this.core) unwrap(await this.core.dispose());
    this.state = { connected: false, name: 'Android', storages: [] };
  }
  async navigate(
    input: string,
    current: string,
    storageId: number | null,
    showHidden: boolean,
  ): Promise<Directory> {
    string(input);
    string(current);
    const id = this.available(storageId);
    const target = path.posix.resolve(current, input);
    const walk = async (directory: string) =>
      entries(
        await this.sdk().walk({ storageId: id, fullPath: directory, skipHiddenFiles: !showHidden }),
      );
    if (target === '/') return { path: '/', files: await walk('/'), selected: [] };
    const parent = path.posix.dirname(target);
    const siblings = await walk(parent);
    let selected = siblings.find(
      (file) => file.path === target || file.name === path.posix.basename(target),
    );
    if (!selected && !showHidden)
      selected = entries(
        await this.sdk().walk({ storageId: id, fullPath: parent, skipHiddenFiles: false }),
      ).find((file) => file.path === target || file.name === path.posix.basename(target));
    if (!selected) throw new AppError('NOT_FOUND', 'The path does not exist');
    if (selected.isFolder) return { path: target, files: await walk(target), selected: [] };
    return {
      path: parent,
      files: siblings.some((file) => file.path === target) ? siblings : [...siblings, selected],
      selected: [target],
    };
  }
  async mutate(request: Mutation) {
    const storageId = this.available(request.storageId);
    string(request.path);
    if (request.type === 'mkdir') {
      filename(request.name);
      unwrap(
        await this.sdk().makeDirectory({
          storageId,
          fullPath: path.posix.join(request.path, request.name),
        }),
      );
    } else if (request.type === 'rename') {
      filename(request.name);
      if (request.name === path.posix.basename(request.path)) return;
      const siblings = entries(
        await this.sdk().walk({
          storageId,
          fullPath: path.posix.dirname(request.path),
          skipHiddenFiles: false,
        }),
      );
      if (siblings.some((file) => file.name === request.name))
        throw new AppError('OVERWRITE_REQUIRED', 'A file with this name already exists');
      unwrap(
        await this.sdk().renameFile({
          storageId,
          fullPath: request.path,
          newFilename: request.name,
        }),
      );
    } else if (request.type === 'delete') {
      if (
        !request.files?.length ||
        request.files.some((file) => typeof file !== 'string' || path.posix.resolve(file) === '/')
      )
        throw new AppError('INVALID_PATH', 'Invalid files');
      unwrap(await this.sdk().deleteFile({ storageId, files: request.files }));
    } else throw new AppError('INVALID_PATH', 'Invalid mutation');
  }
  private async conflicts(request: TransferRequest): Promise<string[]> {
    const conflicts: string[] = [];
    const walk = async (directory: string) =>
      entries(
        await this.sdk().walk({
          storageId: request.storageId,
          fullPath: directory,
          skipHiddenFiles: false,
        }),
      );
    if (request.direction === 'upload') {
      const compare = async (sources: { path: string; name: string }[], destination: string) => {
        const existing = await walk(destination);
        for (const source of sources) {
          const meta = await lstat(source.path);
          if (meta.isSymbolicLink()) continue; // Local symbolic links are not followed.
          const target = existing.find((file) => file.name === source.name);
          if (!target) continue;
          if (target.isFolder !== meta.isDirectory())
            throw new AppError('INVALID_PATH', 'File and folder name conflict');
          if (!target.isFolder) conflicts.push(target.path);
          else {
            const children = await readdir(source.path);
            await compare(
              children.map((name) => ({ name, path: path.join(source.path, name) })),
              target.path,
            );
          }
        }
      };
      await compare(request.sources, request.destination);
    } else {
      if (!(await stat(request.destination)).isDirectory())
        throw new AppError('INVALID_PATH', 'Choose a download directory');
      const compare = async (
        sources: { path: string; name: string; isFolder: boolean }[],
        destination: string,
      ) => {
        for (const source of sources) {
          filename(source.name);
          const target = path.join(destination, source.name);
          const meta = await lstat(target).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (!meta) continue;
          if (meta.isSymbolicLink() || meta.isDirectory() !== source.isFolder)
            throw new AppError('INVALID_PATH', 'File and folder name conflict');
          if (!source.isFolder) conflicts.push(target);
          else await compare(await walk(source.path), target);
        }
      };
      await compare(request.sources, request.destination);
    }
    return [...new Set(conflicts)];
  }
  async transfer(
    request: TransferRequest,
    emit: (update: TransferUpdate) => void,
  ): Promise<string> {
    this.available(request.storageId);
    if (
      !['upload', 'download'].includes(request.direction) ||
      !Array.isArray(request.sources) ||
      !request.sources.length
    )
      throw new AppError('INVALID_PATH', 'Select files to transfer');
    string(request.destination);
    for (const source of request.sources) {
      string(source.path);
      filename(source.name);
    }
    this.busy = true;
    const id = randomUUID();
    const update: TransferUpdate = {
      id,
      direction: request.direction,
      destination: request.destination,
      count: request.sources.length,
      status: 'preparing',
      progress: 0,
      currentFile: '',
      speed: 0,
      elapsed: 0,
      bytesSent: 0,
      totalBytes: 0,
    };
    try {
      const conflicts = await this.conflicts(request);
      if (conflicts.length && !request.overwrite)
        throw new AppError('OVERWRITE_REQUIRED', 'Files with the same names exist');
      if (conflicts.length && request.direction === 'upload')
        unwrap(await this.sdk().deleteFile({ storageId: request.storageId, files: conflicts }));
      emit({ ...update });
      let lastUpdate = Date.now();
      const publish = () => {
        const now = Date.now();
        if (now - lastUpdate >= 80) {
          lastUpdate = now;
          emit({ ...update });
        }
      };
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        update.status = error ? 'failed' : 'completed';
        if (error) update.error = failure(error);
        else {
          update.progress = 100;
          if (update.totalBytes) update.bytesSent = update.totalBytes;
        }
        emit({ ...update });
      };
      void this.sdk()
        .transferFiles({
          direction: request.direction,
          storageId: request.storageId,
          destination: request.destination,
          sources: request.sources.map((file) => file.path),
          preprocessFiles: request.preprocess,
          onPreprocess: (data) => {
            update.currentFile = data.fullPath;
            publish();
          },
          onProgress: (data) => {
            Object.assign(update, {
              status: 'running',
              currentFile: data.fullPath,
              speed: data.speed,
              elapsed: data.elapsedTime,
              progress: request.preprocess
                ? data.bulkFileSize.progress
                : data.activeFileSize.progress,
              bytesSent: data.bulkFileSize.sent,
              totalBytes: data.bulkFileSize.total,
            });
            if (!finished) publish();
          },
          onError: (result) => {
            finish(
              new AppError(
                result.code ?? 'IO_ERROR',
                [result.code, String(result.error ?? '')].filter(Boolean).join(': ') ||
                  'Native transfer failed without a diagnostic',
              ),
            );
          },
          onCompleted: () => finish(),
        })
        .then((result) => {
          if (result.error || result.code)
            finish(new AppError(result.code ?? 'IO_ERROR', String(result.error || result.code)));
        })
        .catch(finish)
        .finally(() => {
          this.busy = false;
        });
      return id;
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }
  async close() {
    if (!this.busy && this.core) await this.core.dispose();
  }
  async diagnostics(): Promise<string> {
    return JSON.stringify(
      {
        platform: process.platform,
        architecture: process.arch,
        connected: this.state.connected,
        device: this.state.name,
        storages: this.state.storages.length,
        busy: this.busy,
        coreLoaded: !!this.core,
        backend: 'libmtp',
        nativeLibrary: path.basename(this.library),
      },
      null,
      2,
    );
  }
}
