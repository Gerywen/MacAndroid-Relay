import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PreferencesStore } from '../electron/preferences';
import { en, zh, errorKey } from '../src/i18n';
test('Preferences persist language/theme and concurrent patches without losing values', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-prefs-'));
  const file = path.join(directory, 'prefs.json');
  try {
    const prefs = new PreferencesStore(file);
    await prefs.load();
    await Promise.all([
      prefs.save({ language: 'en' }),
      prefs.save({ theme: 'dark' }),
      prefs.save({ showHidden: true }),
    ]);
    const restored = await new PreferencesStore(file).load();
    assert.equal(restored.language, 'en');
    assert.equal(restored.theme, 'dark');
    assert.equal(restored.showHidden, true);
    await writeFile(file, 'invalid');
    assert.equal((await new PreferencesStore(file).load()).language, 'zh-CN');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('Chinese/English catalogs have identical keys and every error has a translation', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const code of [
    'NO_DEVICE',
    'DEVICE_LOCKED',
    'BUSY',
    'PERMISSION',
    'NOT_FOUND',
    'OVERWRITE_REQUIRED',
    'INVALID_PATH',
    'UNSUPPORTED',
    'IO_ERROR',
  ] as const) {
    const key = errorKey({ code, message: '' });
    assert(en[key]);
    assert(zh[key]);
  }
});

test('Rename migrates legacy settings once without replacing existing new settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-migrate-'));
  try {
    const oldFile = path.join(directory, 'legacy.json');
    const newFile = path.join(directory, 'renamed.json');
    await writeFile(oldFile, JSON.stringify({ language: 'en', theme: 'dark', autoConnect: false }));
    const migrated = await new PreferencesStore(newFile).load(oldFile);
    assert.equal(migrated.language, 'en');
    assert.equal(migrated.theme, 'dark');
    assert.equal(migrated.autoConnect, false);
    const newPrefs = new PreferencesStore(newFile);
    await newPrefs.load();
    await newPrefs.save({ language: 'zh-CN' });
    assert.equal((await new PreferencesStore(newFile).load(oldFile)).language, 'zh-CN');
    await writeFile(newFile, 'invalid');
    assert.equal((await new PreferencesStore(newFile).load(oldFile)).theme, 'auto');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
