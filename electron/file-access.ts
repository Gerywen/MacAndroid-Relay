import path from 'node:path';
import { realpath, stat, readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { AppError } from './errors';
interface Grant {
  path: string;
  bookmark: string;
}
export class FileAccess {
  private grants: Grant[] = [];
  private releases = new Map<string, () => void>();
  private pending: Promise<void> = Promise.resolve();
  constructor(
    readonly enabled: boolean,
    private store: string,
    private start: (bookmark: string) => () => void,
  ) {}
  get folders(): string[] {
    return this.grants.map((grant) => grant.path);
  }
  async load(): Promise<void> {
    if (!this.enabled) return;
    let records: unknown;
    try {
      records = JSON.parse(await readFile(this.store, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('Folder authorization store could not be read');
      return;
    }
    if (!Array.isArray(records)) return;
    for (const value of records) {
      if (!value || typeof value.path !== 'string' || typeof value.bookmark !== 'string') continue;
      try {
        await this.accept(value.path, value.bookmark, false);
      } catch {
        console.warn('A saved folder authorization needs to be renewed');
      }
    }
  }
  private async accept(selected: string, bookmark: string, persist: boolean): Promise<string> {
    if (!this.enabled) return selected;
    if (!bookmark)
      throw new AppError(
        'PERMISSION',
        'The folder picker did not return a security-scoped bookmark',
      );
    const release = this.start(bookmark);
    let canonical: string;
    try {
      canonical = await realpath(selected);
      if (!(await stat(canonical)).isDirectory())
        throw new AppError('INVALID_PATH', 'Choose a folder');
    } catch (error) {
      release();
      throw error;
    }
    this.releases.get(canonical)?.();
    this.releases.set(canonical, release);
    this.grants = this.grants.filter((grant) => grant.path !== canonical);
    this.grants.push({ path: canonical, bookmark });
    if (persist) {
      const snapshot = JSON.stringify(this.grants);
      const save = async () => {
        await mkdir(path.dirname(this.store), { recursive: true });
        await writeFile(this.store + '.tmp', snapshot, { mode: 0o600 });
        await rename(this.store + '.tmp', this.store);
      };
      this.pending = this.pending.catch(() => {}).then(save);
      await this.pending;
    }
    return canonical;
  }
  grant(selected: string, bookmark: string): Promise<string> {
    return this.accept(selected, bookmark, true);
  }
  async require(input: string): Promise<string> {
    if (!this.enabled) return path.resolve(input);
    if (typeof input !== 'string' || !input || input.includes('\0'))
      throw new AppError('INVALID_PATH', 'Invalid path');
    const absolute = path.resolve(input);
    let ancestor = absolute;
    const tail: string[] = [];
    let canonical: string;
    while (true) {
      try {
        canonical = await realpath(ancestor);
        break;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          ancestor === path.dirname(ancestor)
        )
          throw error;
        tail.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
      }
    }
    const resolved = path.join(canonical, ...tail);
    if (
      !this.grants.some((grant) => {
        const relative = path.relative(grant.path, resolved);
        return (
          !relative ||
          (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
        );
      })
    )
      throw new AppError(
        'PERMISSION',
        'Choose this folder to grant access before browsing or transferring files',
      );
    return resolved;
  }
  protectRoot(file: string): void {
    if (this.enabled && this.grants.some((grant) => grant.path === file))
      throw new AppError('INVALID_PATH', 'Cannot rename or delete an authorized root folder');
  }
  close(): void {
    for (const release of this.releases.values()) release();
    this.releases.clear();
    this.grants = [];
  }
}
