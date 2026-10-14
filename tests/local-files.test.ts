import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalFiles } from '../electron/local-files';
import { AppError } from '../electron/errors';

test('Local navigation supports Unicode files, relative paths, hidden targets and preserves errors', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-test-'));
  try {
    await mkdir(path.join(home, '中文 目录'));
    await writeFile(path.join(home, '文件.txt'), 'hello');
    await writeFile(path.join(home, '.hidden'), 'hidden');
    const files = new LocalFiles(home, async (file) => rm(file, { recursive: true }));
    assert.equal(
      (await files.navigate('~/中文 目录', '/', false)).path,
      path.join(home, '中文 目录'),
    );
    const target = await files.navigate('../文件.txt', path.join(home, '中文 目录'), false);
    assert.deepEqual(target.selected, [path.join(home, '文件.txt')]);
    assert(!target.files.some((file) => file.name === '.hidden'));
    assert(
      (await files.navigate('~/.hidden', '/', false)).files.some((file) => file.name === '.hidden'),
    );
    await assert.rejects(files.navigate('missing', home, false), /ENOENT/);
    await assert.rejects(files.navigate('\0', home, false), AppError);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test('Local create, rename, collision protection and delete affect only selected fixtures', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-test-'));
  const trashed: string[] = [];
  try {
    const files = new LocalFiles(home, async (file) => {
      trashed.push(file);
      await rm(file, { recursive: true });
    });
    const request = { device: 'local' as const, storageId: null, path: home };
    await files.mutate({ ...request, type: 'mkdir', name: '新目录' });
    await access(path.join(home, '新目录'));
    await writeFile(path.join(home, 'a.txt'), 'a');
    await writeFile(path.join(home, 'b.txt'), 'b');
    await assert.rejects(
      files.mutate({ ...request, type: 'rename', path: path.join(home, 'a.txt'), name: 'b.txt' }),
      (error) => error instanceof AppError && error.code === 'OVERWRITE_REQUIRED',
    );
    assert.equal(await readFile(path.join(home, 'b.txt'), 'utf8'), 'b');
    await files.mutate({
      ...request,
      type: 'rename',
      path: path.join(home, 'a.txt'),
      name: '重命名.txt',
    });
    await files.mutate({ ...request, type: 'delete', files: [path.join(home, '重命名.txt')] });
    assert.deepEqual(trashed, [path.join(home, '重命名.txt')]);
    await assert.rejects(files.mutate({ ...request, type: 'mkdir', name: '../escape' }), AppError);
    await assert.rejects(files.mutate({ ...request, type: 'delete', files: [home] }), AppError);
    await assert.rejects(files.mutate({ ...request, type: 'delete', files: ['/'] }), AppError);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
