import type { FileNode, ErrorCode } from '../../shared/contracts';
export type { FileNode };
export type TransferDirection = 'upload' | 'download';
export interface NativeResult<T> {
  data: T | null;
  error?: unknown;
  code?: ErrorCode;
}
export interface NativeDeviceInfo {
  name: string;
  manufacturer: string;
  serial: string;
}
export interface TransferPreprocess {
  fullPath: string;
  name: string;
  size: number;
}
export interface TransferSize {
  total: number;
  sent: number;
  progress: number;
}
export interface TransferProgress {
  fullPath: string;
  name: string;
  elapsedTime: number;
  speed: number;
  totalFiles: number;
  totalDirectories: number;
  filesSent: number;
  filesSentProgress: number;
  activeFileSize: TransferSize;
  bulkFileSize: TransferSize;
  status: string;
}
export interface NativeTransferOptions {
  direction: TransferDirection;
  storageId: number;
  sources: string[];
  destination: string;
  preprocessFiles: boolean;
  overwrite?: boolean;
  cancelled?: () => boolean;
  onError: (result: NativeResult<unknown>) => void;
  onPreprocess: (data: TransferPreprocess) => void;
  onProgress: (data: TransferProgress) => void;
  onCompleted: () => void;
}
