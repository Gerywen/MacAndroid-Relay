import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DeviceSession, type MtpCore } from '../electron/device';
import { AppError } from '../electron/errors';
import type { FileNode, TransferUpdate, TransferRequest } from '../shared/contracts';
import type { NativeTransferOptions } from '../electron/native/types';
const node: FileNode = {
  name: '文件.txt',
  path: '/文件.txt',
  isFolder: false,
  size: 12,
  dateAdded: 0,
};
const core = (): MtpCore => ({
  initialize: async () => ({
    data: { name: 'Android Test', manufacturer: 'Test', serial: '123' },
  }),
  dispose: async () => ({ data: true }),
  listStorages: async () => ({
    data: [
      {
        id: 1,
        name: 'Internal storage',
        capacity: 100,
        available: 80,
      },
    ],
  }),
  walk: async () => ({ data: [node] }),
  makeDirectory: async () => ({ data: true }),
  renameFile: async () => ({ data: true }),
  deleteFile: async () => ({ data: true }),
  transferFiles: async (request) => {
    request.onCompleted();
    return { data: true };
  },
});
test('Connection, storage selection, file navigation and missing paths use the backend-neutral contract', async () => {
  const session = new DeviceSession('fake', () => core(), 'darwin');
  const connection = await session.connect();
  assert.equal(connection.name, 'Android Test');
  assert.equal(connection.storages[0].id, 1);
  assert.deepEqual((await session.navigate('/文件.txt', '/', 1, false)).selected, ['/文件.txt']);
  await assert.rejects(
    session.navigate('/missing', '/', 1, false),
    (error) => error instanceof AppError && error.code === 'NOT_FOUND',
  );
  await session.disconnect();
  await assert.rejects(
    session.navigate('/', '/', 1, false),
    (error) => error instanceof AppError && error.code === 'NO_DEVICE',
  );
});
test('Device absence is a recoverable localized error; unsupported hosts do not load the native core', async () => {
  const fake = core();
  fake.initialize = async () => ({
    data: null,
    error: 'no device',
    code: 'NO_DEVICE',
  });
  await assert.rejects(
    new DeviceSession('fake', () => fake, 'darwin').connect(),
    (error) => error instanceof AppError && error.code === 'NO_DEVICE',
  );
  let loaded = false;
  await assert.rejects(
    new DeviceSession(
      'fake',
      () => {
        loaded = true;
        return core();
      },
      'win32',
    ).connect(),
    (error) => error instanceof AppError && error.code === 'UNSUPPORTED',
  );
  assert.equal(loaded, false);
});
test('Upload conflicts require confirmation without pre-deleting originals; completion releases the lock', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-transfer-'));
  try {
    const file = path.join(home, '文件.txt');
    await writeFile(file, 'payload');
    const fake = core();
    let deleted = 0;
    let transferred = 0;
    fake.deleteFile = async (args) => {
      assert.deepEqual(args.files, ['/文件.txt']);
      deleted++;
      return { data: true };
    };
    fake.transferFiles = async (args) => {
      transferred++;
      args.onProgress({
        fullPath: file,
        name: '文件.txt',
        elapsedTime: 100,
        speed: 10,
        totalFiles: 1,
        totalDirectories: 0,
        filesSent: 1,
        filesSentProgress: 100,
        activeFileSize: { total: 7, sent: 7, progress: 100 },
        bulkFileSize: { total: 7, sent: 7, progress: 100 },
        status: 'running',
      });
      args.onCompleted();
      args.onCompleted();
      return { data: true };
    };
    const session = new DeviceSession('fake', () => fake, 'darwin');
    await session.connect();
    const request: TransferRequest = {
      direction: 'upload',
      storageId: 1,
      destination: '/',
      sources: [{ path: file, name: '文件.txt', isFolder: false }],
      overwrite: false,
      preprocess: true,
    };
    await assert.rejects(
      session.transfer(request, () => {}),
      (error) => error instanceof AppError && error.code === 'OVERWRITE_REQUIRED',
    );
    assert.equal(deleted, 0);
    assert.equal(transferred, 0);
    assert.equal(session.active, false);
    const events: TransferUpdate[] = [];
    await session.transfer({ ...request, overwrite: true }, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deleted, 0);
    assert.equal(transferred, 1);
    assert.equal(events.filter((event) => event.status === 'completed').length, 1);
    assert.equal(session.active, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test('In-flight download rejects concurrent operations and failure cannot emit later success', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-transfer-'));
  try {
    const fake = core();
    let options: NativeTransferOptions | undefined;
    let finish: (value: { data: boolean }) => void = () => {};
    fake.transferFiles = (args) => {
      options = args;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const session = new DeviceSession('fake', () => fake, 'darwin');
    await session.connect();
    const events: TransferUpdate[] = [];
    await session.transfer(
      {
        direction: 'download',
        storageId: 1,
        destination: home,
        sources: [node],
        overwrite: false,
        preprocess: true,
      },
      (event) => events.push(event),
    );
    assert(session.active);
    await assert.rejects(
      session.connect(),
      (error) => error instanceof AppError && error.code === 'BUSY',
    );
    await assert.rejects(
      session.navigate('/', '/', 1, false),
      (error) => error instanceof AppError && error.code === 'BUSY',
    );
    options!.onError({ data: null, error: 'USB disconnected' });
    options!.onCompleted();
    finish({ data: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(events.filter((event) => event.status === 'failed').length, 1);
    assert(!events.some((event) => event.status === 'completed'));
    assert.equal(session.active, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('An empty device directory is null, not a failed operation, and accepts the first upload', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-empty-'));
  try {
    const file = path.join(home, 'first.txt');
    await writeFile(file, 'First file');
    const fake = core();
    fake.walk = async () => ({ data: null, error: null, code: undefined });
    let transferred = false;
    fake.transferFiles = async (options) => {
      transferred = true;
      options.onCompleted();
      return { data: true };
    };
    const session = new DeviceSession('fake', () => fake, 'darwin');
    await session.connect();
    assert.deepEqual((await session.navigate('/', '/', 1, false)).files, []);
    await session.transfer(
      {
        direction: 'upload',
        storageId: 1,
        destination: '/',
        sources: [{ path: file, name: 'first.txt', isFolder: false }],
        overwrite: false,
        preprocess: true,
      },
      () => {},
    );
    assert(transferred);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.walk = async () => ({ data: null, error: 'Access denied', code: 'PERMISSION' });
    await assert.rejects(session.navigate('/', '/', 1, false), /Access denied/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Folder merges detect nested collisions without pre-deleting matching files', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-merge-'));
  try {
    const source = path.join(home, '资料');
    await mkdir(source);
    await writeFile(path.join(source, '文件.txt'), 'new content');
    const folder: FileNode = {
      name: '资料',
      path: '/资料',
      isFolder: true,
      size: null,
      dateAdded: 0,
    };
    const child: FileNode = { ...node, path: '/资料/文件.txt' };
    const fake = core();
    fake.walk = async (input) => ({
      data:
        input.fullPath === '/'
          ? [folder]
          : [child, { ...node, name: '保留.txt', path: '/资料/保留.txt' }],
    });
    let removed: string[] = [];
    fake.deleteFile = async (input) => {
      removed = input.files;
      return { data: true };
    };
    const session = new DeviceSession('fake', () => fake, 'darwin');
    await session.connect();
    const request: TransferRequest = {
      direction: 'upload',
      storageId: 1,
      destination: '/',
      sources: [{ path: source, name: '资料', isFolder: true }],
      overwrite: false,
      preprocess: true,
    };
    await assert.rejects(
      session.transfer(request, () => {}),
      (error) => error instanceof AppError && error.code === 'OVERWRITE_REQUIRED',
    );
    assert.deepEqual(removed, []);
    await session.transfer({ ...request, overwrite: true }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(removed, []);
    await assert.rejects(
      session.transfer(
        { ...request, direction: 'download', destination: home, sources: [folder] },
        () => {},
      ),
      (error) => error instanceof AppError && error.code === 'OVERWRITE_REQUIRED',
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Device rename refuses existing names before calling the native mutation', async () => {
  const fake = core();
  let renamed = 0;
  fake.renameFile = async () => {
    renamed++;
    return { data: true };
  };
  const session = new DeviceSession('fake', () => fake, 'darwin');
  await session.connect();
  await assert.rejects(
    session.mutate({
      device: 'mtp',
      type: 'rename',
      storageId: 1,
      path: '/old.txt',
      name: '文件.txt',
    }),
    (error) => error instanceof AppError && error.code === 'OVERWRITE_REQUIRED',
  );
  assert.equal(renamed, 0);
  await session.mutate({
    device: 'mtp',
    type: 'rename',
    storageId: 1,
    path: '/文件.txt',
    name: '文件.txt',
  });
  assert.equal(renamed, 0);
  await session.mutate({
    device: 'mtp',
    type: 'rename',
    storageId: 1,
    path: '/old.txt',
    name: 'new.txt',
  });
  assert.equal(renamed, 1);
});
