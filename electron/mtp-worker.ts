import { DeviceSession } from './device';
import { reply } from './errors';
import type { MtpRequest, MtpMessage } from './mtp-protocol';
const port = process.parentPort;
if (!port) throw new Error('The MTP service must run in an Electron utility process');
const library = process.argv[2];
if (!library) throw new Error('Missing native library path');
const device = new DeviceSession(library);
const post = (message: MtpMessage) => port.postMessage(message);
async function execute(request: MtpRequest): Promise<unknown> {
  switch (request.command) {
    case 'connect':
      return device.connect();
    case 'disconnect':
      return device.disconnect();
    case 'navigate':
      return device.navigate(...request.args);
    case 'mutate':
      return device.mutate(...request.args);
    case 'transfer':
      return device.transfer(request.args[0], (update) => post({ type: 'transfer', update }));
    case 'diagnostics':
      return device.diagnostics();
    case 'close':
      return device.close();
  }
}
let queue: Promise<unknown> = Promise.resolve();
port.on('message', (event) => {
  const request = event.data as MtpRequest;
  if (request.type !== 'request') return;
  queue = queue
    .then(async () =>
      post({ type: 'response', id: request.id, reply: await reply(() => execute(request)) }),
    )
    .catch((error) => console.error('MTP service response failed', error));
});
