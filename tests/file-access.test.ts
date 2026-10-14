import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileAccess } from '../electron/file-access';
import { AppError } from '../electron/errors';
const permission = (error: unknown) => error instanceof AppError && error.code === 'PERMISSION';
test('Folder grants reject siblings, traversal and symlink escapes, persist across restart and release scopes', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'relay-access-'));
  const root = path.join(home, 'allowed'),
    outside = path.join(home, 'allowed-other');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(root, 'file'), 'hello');
  await writeFile(path.join(outside, 'secret'), 'private');
  await symlink(outside, path.join(root, 'escape'));
  let started = 0,
    stopped = 0;
  const start = (bookmark: string) => {
    assert.equal(bookmark, 'bookmark');
    started++;
    return () => {
      stopped++;
    };
  };
  const store = path.join(home, 'profile/grants.json');
  const access = new FileAccess(true, store, start);
  try {
    await assert.rejects(access.require(root), permission);
    await access.grant(root, 'bookmark');
    assert.equal(
      await access.require(path.join(root, 'new', 'file')),
      path.join(await access.require(root), 'new', 'file'),
    );
    await assert.rejects(access.require(outside), permission);
    await assert.rejects(
      access.require(path.join(root, '..', 'allowed-other', 'secret')),
      permission,
    );
    await assert.rejects(access.require(path.join(root, 'escape', 'secret')), permission);
    await assert.rejects(access.require(path.join(root, 'escape', 'new')), permission);
    assert.throws(() => access.protectRoot(access.folders[0]), /root folder/);
    assert.equal(JSON.parse(await readFile(store, 'utf8'))[0].bookmark, 'bookmark');
    access.close();
    assert.equal(stopped, 1);
    const restored = new FileAccess(true, store, start);
    await restored.load();
    assert.equal(restored.folders.length, 1);
    await restored.require(path.join(root, 'file'));
    restored.close();
    assert.equal(started, 2);
    assert.equal(stopped, 2);
  } finally {
    access.close();
    await rm(home, { recursive: true, force: true });
  }
});
test('Invalid bookmarks do not create an authorization and unrestricted mode needs no bookmark', async () => {
  const access = new FileAccess(true, 'unused', () => {
    throw new Error('Expired bookmark');
  });
  await assert.rejects(access.grant('/tmp', 'expired'), /Expired bookmark/);
  assert.deepEqual(access.folders, []);
  const normal = new FileAccess(false, 'unused', () => {
    throw new Error('must not run');
  });
  assert.equal(await normal.require('/tmp/anywhere'), '/tmp/anywhere');
});
