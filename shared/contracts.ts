export type Device = 'local' | 'mtp';
export type Language = 'zh-CN' | 'en';
export type Theme = 'auto' | 'light' | 'dark';
export interface FileNode {
  name: string;
  path: string;
  isFolder: boolean;
  size: number | null;
  dateAdded: number | string;
  symlink?: string | null;
}
export interface Preferences {
  language: Language;
  theme: Theme;
  view: 'list' | 'grid';
  showHidden: boolean;
  directoriesFirst: boolean;
  autoConnect: boolean;
  preprocess: boolean;
}
export type ErrorCode =
  | 'NO_DEVICE'
  | 'DEVICE_LOCKED'
  | 'BUSY'
  | 'PERMISSION'
  | 'NOT_FOUND'
  | 'OVERWRITE_REQUIRED'
  | 'INVALID_PATH'
  | 'UNSUPPORTED'
  | 'IO_ERROR';
export interface Failure {
  code: ErrorCode;
  message: string;
}
export type Reply<T> = { ok: true; data: T } | { ok: false; error: Failure };
export interface Storage {
  id: number;
  name: string;
  capacity: number;
  available: number;
}
export interface Connection {
  connected: boolean;
  name: string;
  storages: Storage[];
}
export interface Bootstrap {
  home: string;
  requiresFolderAuthorization?: boolean;
  shortcuts: { name: 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures'; path: string }[];
  preferences: Preferences;
  version: string;
}
export interface NavigationRequest {
  device: Device;
  path: string;
  currentPath: string;
  storageId: number | null;
  showHidden: boolean;
}
export interface Directory {
  path: string;
  files: FileNode[];
  selected: string[];
}
export interface Mutation {
  device: Device;
  type: 'mkdir' | 'rename' | 'delete';
  storageId: number | null;
  path: string;
  name?: string;
  files?: string[];
}
export interface TransferRequest {
  direction: 'upload' | 'download';
  storageId: number;
  destination: string;
  sources: { path: string; name: string; isFolder: boolean }[];
  overwrite: boolean;
  preprocess: boolean;
}
export interface TransferUpdate {
  id: string;
  direction: 'upload' | 'download';
  destination: string;
  count: number;
  status: 'preparing' | 'running' | 'completed' | 'failed';
  progress: number;
  currentFile: string;
  speed: number;
  elapsed: number;
  bytesSent: number;
  totalBytes: number;
  error?: Failure;
}
export interface DesktopApi {
  onCommand(
    callback: (command: 'select-all' | 'settings' | 'new-folder' | 'refresh' | 'parent') => void,
  ): () => void;
  bootstrap(): Promise<Reply<Bootstrap>>;
  preferences(patch: Partial<Preferences>): Promise<Reply<Preferences>>;
  navigate(request: NavigationRequest): Promise<Reply<Directory>>;
  mutate(request: Mutation): Promise<Reply<void>>;
  connect(): Promise<Reply<Connection>>;
  disconnect(): Promise<Reply<void>>;
  transfer(request: TransferRequest): Promise<Reply<{ id: string }>>;
  onTransfer(callback: (update: TransferUpdate) => void): () => void;
  onDeviceChanged(callback: (reason: 'change' | 'unavailable') => void): () => void;
  chooseFolder(): Promise<Reply<string | null>>;
  openFile(path: string): Promise<Reply<void>>;
  copyText(text: string): Promise<Reply<void>>;
  openHelp(): Promise<Reply<void>>;
  diagnostics(): Promise<Reply<string>>;
  filePaths(files: File[]): string[];
}
