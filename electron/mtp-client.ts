import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { AppError } from './errors';
import type { Mutation, TransferRequest, TransferUpdate } from '../shared/contracts';
import type { MtpMessage, MtpOperations } from './mtp-protocol';
/** Only this utility process owns native USB state. It is released before stopping it. */
export class MtpClient {
  private process?: UtilityProcess;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (error: Error) => void }
  >();
  private transferListener?: (update: TransferUpdate) => void;
  private lastTransfer?: TransferUpdate;
  private busy = false;
  private stopping = false;
  constructor(
    private library: string,
    private onCrash: () => void,
  ) {}
  get active() {
    return this.busy;
  }
  private start() {
    if (this.process) return this.process;
    this.stopping = false;
    const child = utilityProcess.fork(path.join(__dirname, 'mtp-worker.cjs'), [this.library], {
      serviceName: 'MacAndroid Relay MTP service',
      stdio: 'inherit',
      allowLoadingUnsignedLibraries: true,
    });
    this.process = child;
    child.on('message', (message: MtpMessage) => {
      if (message.type === 'response') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.reply.ok) pending.resolve(message.reply.data);
        else pending.reject(new AppError(message.reply.error.code, message.reply.error.message));
      } else if (message.type === 'transfer') {
        this.lastTransfer = message.update;
        if (message.update.status === 'completed' || message.update.status === 'failed')
          this.busy = false;
        this.transferListener?.(message.update);
      }
    });
    child.once('exit', (code) => {
      if (this.process !== child) return;
      this.process = undefined;
      const error = new AppError(
        'IO_ERROR',
        `The MTP service exited (${code}). Reconnect the device to continue.`,
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      if (this.busy && this.lastTransfer)
        this.transferListener?.({
          ...this.lastTransfer,
          status: 'failed',
          error: { code: error.code, message: error.message },
        });
      this.busy = false;
      if (!this.stopping) this.onCrash();
    });
    return child;
  }
  private call<K extends keyof MtpOperations>(
    command: K,
    ...args: MtpOperations[K]['args']
  ): Promise<MtpOperations[K]['result']> {
    const child = this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (data) => resolve(data as MtpOperations[K]['result']),
        reject,
      });
      try {
        child.postMessage({ type: 'request', id, command, args });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  connect() {
    return this.call('connect');
  }
  disconnect() {
    return this.call('disconnect');
  }
  navigate(input: string, current: string, storageId: number | null, showHidden: boolean) {
    return this.call('navigate', input, current, storageId, showHidden);
  }
  mutate(request: Mutation) {
    return this.call('mutate', request);
  }
  async transfer(request: TransferRequest, emit: (update: TransferUpdate) => void) {
    if (this.busy) throw new AppError('BUSY', 'A transfer is active');
    this.busy = true;
    this.transferListener = emit;
    this.lastTransfer = undefined;
    try {
      return await this.call('transfer', request);
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }
  diagnostics() {
    return this.process
      ? this.call('diagnostics')
      : Promise.resolve(
          JSON.stringify(
            {
              platform: process.platform,
              architecture: process.arch,
              coreLoaded: false,
              busy: false,
            },
            null,
            2,
          ),
        );
  }
  async close() {
    if (!this.process || this.busy) return;
    this.stopping = true;
    const child = this.process;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Dispose the USB session first; then stop the isolated native service.
      await Promise.race([
        this.call('close'),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      if (this.process === child) {
        child.kill();
        await exited;
      }
    }
  }
}
