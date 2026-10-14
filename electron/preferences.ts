import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Preferences } from '../shared/contracts';
export const DEFAULTS: Preferences = {
  language: 'zh-CN',
  theme: 'auto',
  view: 'list',
  showHidden: false,
  directoriesFirst: true,
  autoConnect: true,
  preprocess: true,
};
export class PreferencesStore {
  private value: Preferences = { ...DEFAULTS };
  constructor(private file: string) {}
  async load(legacyFile?: string) {
    try {
      this.value = this.validate(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      this.value = { ...DEFAULTS };
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && legacyFile) {
        try {
          this.value = this.validate(JSON.parse(await readFile(legacyFile, 'utf8')));
          await this.save({});
        } catch {
          this.value = { ...DEFAULTS };
        }
      }
    }
    return this.get();
  }
  get(): Preferences {
    return { ...this.value };
  }
  private validate(patch: Partial<Preferences>): Preferences {
    const next = { ...this.value };
    if (patch.language === 'en' || patch.language === 'zh-CN') next.language = patch.language;
    if (['light', 'dark', 'auto'].includes(patch.theme ?? '')) next.theme = patch.theme!;
    if (patch.view === 'list' || patch.view === 'grid') next.view = patch.view;
    for (const key of ['showHidden', 'directoriesFirst', 'autoConnect', 'preprocess'] as const)
      if (typeof patch[key] === 'boolean') next[key] = patch[key];
    return next;
  }
  private pending: Promise<unknown> = Promise.resolve();
  async save(patch: Partial<Preferences>) {
    const next = this.validate(patch);
    this.value = next;
    const persist = async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    };
    this.pending = this.pending.catch(() => undefined).then(persist);
    await this.pending;
    return { ...next };
  }
}
