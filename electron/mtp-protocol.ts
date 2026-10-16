import type {
  Connection,
  Directory,
  Mutation,
  TransferRequest,
  TransferUpdate,
  Reply,
} from '../shared/contracts';
export interface MtpOperations {
  connect: { args: []; result: Connection };
  disconnect: { args: []; result: void };
  navigate: {
    args: [input: string, current: string, storageId: number | null, showHidden: boolean];
    result: Directory;
  };
  mutate: { args: [request: Mutation]; result: void };
  transfer: { args: [request: TransferRequest]; result: string };
  diagnostics: { args: []; result: string };
  cancelTransfer: { args: []; result: void };
  close: { args: []; result: void };
}
export type MtpRequest = {
  [K in keyof MtpOperations]: {
    type: 'request';
    id: number;
    command: K;
    args: MtpOperations[K]['args'];
  };
}[keyof MtpOperations];
export type MtpMessage =
  | { type: 'response'; id: number; reply: Reply<unknown> }
  | { type: 'transfer'; update: TransferUpdate };
