import { writeFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as koffi from 'koffi';
import { Libmtp } from '../electron/native/Libmtp';
import {
  FileStruct,
  RawDevice,
  StorageStruct,
  ErrorStruct,
  DeviceHeader,
} from '../electron/native/libmtp-bindings';
import type { NativeTransferOptions } from '../electron/native/types';
test(
  'libmtp ABI, owned list lifetime, recursive transfers and failed-download preservation',
  { skip: process.platform !== 'darwin' },
  async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'relay-libmtp-test-'));
    const library = path.join(home, 'fixture.dylib');
    try {
      const build = spawnSync(
        'clang',
        ['-dynamiclib', '-I', 'native/include', 'tests/fixtures/libmtp.c', '-o', library],
        { encoding: 'utf8' },
      );
      assert.equal(build.status, 0, build.stderr);
      const probe = koffi.load(library);
      for (const [name, type] of [
        ['SizeFile', FileStruct],
        ['SizeRaw', RawDevice],
        ['SizeStorage', StorageStruct],
        ['SizeError', ErrorStruct],
      ] as const)
        assert.equal(probe.func(`size_t ${name}(void)`)(), koffi.sizeof(type), name);
      for (const [name, type, member] of [
        ['OffsetStorage', DeviceHeader, 'storage'],
        ['OffsetFilename', FileStruct, 'filename'],
        ['OffsetFilesize', FileStruct, 'filesize'],
        ['OffsetNext', FileStruct, 'next'],
      ] as const)
        assert.equal(probe.func(`size_t ${name}(void)`)(), koffi.offsetof(type, member), name);
      assert.equal(probe.func('int UnknownFiletype(void)')(), 44);
      const allocated = probe.func('int FixtureAllocations(void)');
      const badName = probe.func('void FixtureBadName(int flag)');
      const fail = probe.func('void FixtureFailDownload(int flag)');
      const core = new Libmtp(library);
      assert.equal(
        (await core.walk({ storageId: 1, fullPath: '/', skipHiddenFiles: false })).code,
        'NO_DEVICE',
      );
      assert.equal((await core.initialize()).data?.name, 'Independent MTP fixture');
      assert.equal((await core.listStorages()).data?.[0].id, 1);
      for (let i = 0; i < 100; i++) {
        assert.equal(
          (await core.walk({ storageId: 1, fullPath: '/', skipHiddenFiles: false })).data?.length,
          2,
        );
        assert.equal(allocated(), 0);
      }
      badName(1);
      assert.equal(
        (await core.walk({ storageId: 1, fullPath: '/', skipHiddenFiles: false })).code,
        'INVALID_PATH',
      );
      assert.equal(allocated(), 0);
      badName(0);
      const concurrent = await Promise.all([
        core.walk({ storageId: 1, fullPath: '/', skipHiddenFiles: false }),
        core.dispose(),
      ]);
      assert.equal(concurrent[1].code, 'BUSY');
      const source = path.join(home, '中文目录'),
        download = path.join(home, 'download');
      await mkdir(path.join(source, 'nested'), { recursive: true });
      await mkdir(download);
      await writeFile(path.join(source, 'empty'), '');
      await writeFile(path.join(source, 'nested', '文件.txt'), '中文 transfer');
      let completed = 0,
        errors = 0;
      const options: NativeTransferOptions = {
        direction: 'upload',
        storageId: 1,
        sources: [source],
        destination: '/',
        preprocessFiles: true,
        onPreprocess: () => {},
        onProgress: () => {},
        onCompleted: () => {
          completed++;
        },
        onError: () => {
          errors++;
        },
      };
      assert.equal((await core.transferFiles(options)).data, true);
      assert.equal(
        (
          await core.transferFiles({
            ...options,
            direction: 'download',
            sources: ['/中文目录'],
            destination: download,
          })
        ).data,
        true,
      );
      assert.equal(
        await readFile(path.join(download, '中文目录', 'nested', '文件.txt'), 'utf8'),
        '中文 transfer',
      );
      assert.equal((await readFile(path.join(download, '中文目录', 'empty'))).length, 0);
      await writeFile(path.join(download, '文件.txt'), 'preserve me');
      fail(1);
      assert.equal(
        (
          await core.transferFiles({
            ...options,
            direction: 'download',
            sources: ['/文件.txt'],
            destination: download,
          })
        ).code,
        'IO_ERROR',
      );
      assert.equal(await readFile(path.join(download, '文件.txt'), 'utf8'), 'preserve me');
      assert(!(await readdir(download)).some((name) => name.endsWith('.partial')));
      assert.equal(completed, 2);
      assert.equal(errors, 1);
      assert.equal(allocated(), 0);
      fail(0);
      const downloadOptions: NativeTransferOptions = {
        ...options,
        direction: 'download',
        sources: ['/文件.txt'],
        destination: download,
        overwrite: false,
      };
      const target = path.join(download, '文件.txt');
      await rm(target);
      // A different application creates the destination after our initial conflict scan.
      assert.equal(
        (
          await core.transferFiles({
            ...downloadOptions,
            onProgress: () => {
              writeFileSync(target, 'created concurrently');
            },
          })
        ).code,
        'OVERWRITE_REQUIRED',
      );
      assert.equal(await readFile(target, 'utf8'), 'created concurrently');
      assert(!(await readdir(download)).some((name) => name.endsWith('.partial')));
      assert.equal((await core.transferFiles({ ...downloadOptions, overwrite: true })).data, true);
      assert.equal(await readFile(target, 'utf8'), 'data');
      const shortDownload = probe.func('void FixtureShortDownload(int flag)');
      shortDownload(1);
      await writeFile(target, 'keep original');
      assert.equal(
        (await core.transferFiles({ ...downloadOptions, overwrite: true })).code,
        'IO_ERROR',
      );
      assert.equal(await readFile(target, 'utf8'), 'keep original');
      await rm(target);
      assert.equal((await core.transferFiles(downloadOptions)).code, 'IO_ERROR');
      assert(!(await readdir(download)).includes('文件.txt'));
      assert(!(await readdir(download)).some((name) => name.endsWith('.partial')));
      shortDownload(0);
      assert.equal((await core.transferFiles(downloadOptions)).data, true);
      assert.equal(await readFile(target, 'utf8'), 'data');
      assert.equal(
        (await core.renameFile({ storageId: 1, fullPath: '/中文目录', newFilename: 'renamed' }))
          .data,
        true,
      );
      assert.equal((await core.deleteFile({ storageId: 1, files: ['/renamed'] })).data, true);
      assert.equal(
        (await core.walk({ storageId: 1, fullPath: '/', skipHiddenFiles: false })).data?.length,
        2,
      );
      const replacement = path.join(home, '文件.txt');
      await writeFile(replacement, 'replacement content');
      const upload = { ...options, sources: [replacement], overwrite: true };
      const verifyOriginal = async (expected: string) => {
        assert.equal(
          (
            await core.transferFiles({
              ...options,
              direction: 'download',
              sources: ['/文件.txt'],
              destination: download,
              overwrite: true,
            })
          ).data,
          true,
        );
        assert.equal(await readFile(path.join(download, '文件.txt'), 'utf8'), expected);
      };
      const failUpload = probe.func('void FixtureFailUpload(int flag)');
      const failRename = probe.func('void FixtureFailRename(int flag)');
      failUpload(1);
      assert.equal((await core.transferFiles(upload)).code, 'IO_ERROR');
      failUpload(0);
      await verifyOriginal('data');
      let cancelled = false;
      assert.equal(
        (
          await core.transferFiles({
            ...upload,
            cancelled: () => cancelled,
            onProgress: () => {
              cancelled = true;
            },
          })
        ).code,
        'CANCELLED',
      );
      await verifyOriginal('data');
      failRename(2); // Backup succeeds, publishing the new file fails; rollback must restore original.
      assert.equal((await core.transferFiles(upload)).code, 'IO_ERROR');
      await verifyOriginal('data');
      assert.equal((await core.transferFiles(upload)).data, true);
      await verifyOriginal('replacement content');
      assert.equal(allocated(), 0);
      assert.equal((await core.dispose()).data, true);
      probe.unload();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
