import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class Service extends EventEmitter {
  messages: { id: number; command: string }[] = [];
  killed = false;
  postMessage(message: { id: number; command: string }) {
    this.messages.push(message);
  }
  kill() {
    this.killed = true;
    this.emit('exit', 0);
  }
  respond(data: unknown) {
    this.emit('message', {
      type: 'response',
      id: this.messages.at(-1)!.id,
      reply: { ok: true, data },
    });
  }
}
Object.defineProperty(globalThis, '__dirname', { value: '/fixture', configurable: true });
let child: Service;
mock.module('electron', {
  namedExports: { utilityProcess: { fork: () => (child = new Service()) } },
});
const { MtpClient } = await import('../electron/mtp-client');

test('Unresponsive requests are rejected and a subsequent connection creates a new service', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let crashes = 0;
  const client = new MtpClient('fixture', () => crashes++);
  const connection = client.connect();
  const rejected = assert.rejects(connection, (error: any) => error.code === 'TIMEOUT');
  const old = child;
  t.mock.timers.tick(120000);
  await rejected;
  assert.equal(old.killed, true);
  assert.equal(crashes, 1);
  const retry = client.connect();
  assert.notEqual(child, old);
  child.respond({ connected: true, name: 'test', storages: [] });
  await retry;
  t.mock.timers.reset();
});

test('Cancellation escalates after ten seconds, reports a terminal update and ignores late messages', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new MtpClient('fixture', () => {});
  const updates: any[] = [];
  const transfer = client.transfer(
    {
      direction: 'upload',
      storageId: 1,
      destination: '/',
      sources: [],
      overwrite: false,
      preprocess: true,
    },
    (update) => updates.push(update),
  );
  child.respond('job');
  await transfer;
  child.emit('message', {
    type: 'transfer',
    update: { id: 'job', status: 'running', progress: 20 },
  });
  const cancel = client.cancelTransfer();
  child.respond(undefined);
  await cancel;
  t.mock.timers.tick(10000);
  assert.equal(child.killed, true);
  assert.equal(client.active, false);
  assert.equal(updates.at(-1).error.code, 'CANCELLED');
  const count = updates.length;
  child.emit('message', { type: 'transfer', update: { id: 'job', status: 'completed' } });
  assert.equal(updates.length, count);
  t.mock.timers.reset();
});
