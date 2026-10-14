import { readdir, stat, lstat, mkdir, rename, access } from 'node:fs/promises';
import path from 'node:path';
import type { Directory, FileNode, Mutation } from '../shared/contracts';
import { AppError, filename, string } from './errors';
export class LocalFiles {
  constructor(
    readonly home: string,
    private trash: (file: string) => Promise<void>,
    private authorize?: (file: string) => Promise<string>,
  ) {}
  resolve(input: string, current: string): string {
    string(input);
    string(current);
    const value =
      input === '~' || input.startsWith('~/') ? path.join(this.home, input.slice(1)) : input;
    return path.resolve(current, value);
  }
  async list(directory: string, showHidden: boolean): Promise<FileNode[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => showHidden || !entry.name.startsWith('.'))
        .map(async (entry) => {
          const file = path.join(directory, entry.name);
          try {
            if (this.authorize) await this.authorize(file);
            const meta = await stat(file).catch(() => lstat(file));
            return {
              name: entry.name,
              path: file,
              isFolder: meta.isDirectory(),
              size: meta.isDirectory() ? null : meta.size,
              dateAdded: meta.mtimeMs,
            } satisfies FileNode;
          } catch {
            return null;
          }
        }),
    );
    return files.filter((file): file is NonNullable<typeof file> => file !== null);
  }
  async navigate(input: string, current: string, showHidden: boolean): Promise<Directory> {
    const target = this.resolve(input, current);
    const meta = await stat(target);
    const directory = meta.isDirectory() ? target : path.dirname(target);
    const files = await this.list(directory, showHidden);
    if (!meta.isDirectory() && !files.some((file) => file.path === target))
      files.push({
        name: path.basename(target),
        path: target,
        isFolder: false,
        size: meta.size,
        dateAdded: meta.mtimeMs,
      });
    return { path: directory, files, selected: meta.isDirectory() ? [] : [target] };
  }
  async mutate(request: Mutation): Promise<void> {
    string(request.path);
    const directory = path.resolve(request.path);
    if (request.type === 'mkdir') {
      filename(request.name);
      await mkdir(path.join(directory, request.name));
      return;
    }
    if (request.type === 'rename') {
      filename(request.name);
      const destination = path.join(path.dirname(directory), request.name);
      if (destination === directory) return;
      const exists = await access(destination).then(
        () => true,
        () => false,
      );
      if (exists) throw new AppError('OVERWRITE_REQUIRED', 'A file with this name already exists');
      await rename(directory, destination);
      return;
    }
    if (request.type !== 'delete' || !Array.isArray(request.files) || !request.files.length)
      throw new AppError('INVALID_PATH', 'Invalid mutation');
    for (const file of request.files) {
      string(file);
      const absolute = path.resolve(file);
      if (absolute === path.parse(absolute).root || absolute === this.home)
        throw new AppError('INVALID_PATH', 'Cannot delete this directory');
      await this.trash(absolute);
    }
  }
}
