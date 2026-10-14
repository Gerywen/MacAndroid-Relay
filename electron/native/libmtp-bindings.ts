import * as koffi from 'koffi';
export type Address = bigint | null;
// Public structures from libmtp 1.1.23. Pointers are decoded before their owner is freed.
export const DeviceEntry = koffi.struct('RelayDeviceEntry', {
  vendor: 'void *',
  vendor_id: 'uint16_t',
  product: 'void *',
  product_id: 'uint16_t',
  device_flags: 'uint32_t',
});
export const RawDevice = koffi.struct('RelayRawDevice', {
  device_entry: DeviceEntry,
  bus_location: 'uint32_t',
  devnum: 'uint8_t',
});
export const DeviceHeader = koffi.struct('RelayDeviceHeader', {
  object_bitsize: 'uint8_t',
  params: 'void *',
  usbinfo: 'void *',
  storage: 'void *',
});
export const StorageStruct = koffi.struct('RelayStorage', {
  id: 'uint32_t',
  StorageType: 'uint16_t',
  FilesystemType: 'uint16_t',
  AccessCapability: 'uint16_t',
  MaxCapacity: 'uint64_t',
  FreeSpaceInBytes: 'uint64_t',
  FreeSpaceInObjects: 'uint64_t',
  StorageDescription: 'void *',
  VolumeIdentifier: 'void *',
  next: 'void *',
  prev: 'void *',
});
export const FileStruct = koffi.struct('RelayFile', {
  item_id: 'uint32_t',
  parent_id: 'uint32_t',
  storage_id: 'uint32_t',
  filename: 'void *',
  filesize: 'uint64_t',
  modificationdate: 'int64_t',
  filetype: 'int',
  next: 'void *',
});
export const ErrorStruct = koffi.struct('RelayError', {
  errornumber: 'int',
  error_text: 'void *',
  next: 'void *',
});
export const ProgressCallback = koffi.proto(
  'int RelayProgress(uint64_t sent, uint64_t total, const void *data)',
);
export interface NativeFile {
  item_id: number;
  parent_id: number;
  storage_id: number;
  filename: Address;
  filesize: number | bigint;
  modificationdate: number | bigint;
  filetype: number;
  next: Address;
}
export interface NativeStorage {
  id: number;
  MaxCapacity: number | bigint;
  FreeSpaceInBytes: number | bigint;
  StorageDescription: Address;
  next: Address;
}
const definitions = {
  init: 'void LIBMTP_Init(void)',
  detect: 'int LIBMTP_Detect_Raw_Devices(_Out_ void **devices, _Out_ int *count)',
  open: 'void *LIBMTP_Open_Raw_Device_Uncached(void *raw)',
  release: 'void LIBMTP_Release_Device(void *device)',
  manufacturer: 'void *LIBMTP_Get_Manufacturername(void *device)',
  model: 'void *LIBMTP_Get_Modelname(void *device)',
  serial: 'void *LIBMTP_Get_Serialnumber(void *device)',
  free: 'void LIBMTP_FreeMemory(void *value)',
  storage: 'int LIBMTP_Get_Storage(void *device, int sort)',
  errors: 'void *LIBMTP_Get_Errorstack(void *device)',
  clearErrors: 'void LIBMTP_Clear_Errorstack(void *device)',
  list: 'void *LIBMTP_Get_Files_And_Folders(void *device, uint32_t storage, uint32_t parent)',
  metadata: 'void *LIBMTP_Get_Filemetadata(void *device, uint32_t object)',
  newFile: 'void *LIBMTP_new_file_t(void)',
  destroyFile: 'void LIBMTP_destroy_file_t(void *file)',
  mkdir:
    'uint32_t LIBMTP_Create_Folder(void *device, char *name, uint32_t parent, uint32_t storage)',
  rename: 'int LIBMTP_Set_File_Name(void *device, void *file, const char *name)',
  delete: 'int LIBMTP_Delete_Object(void *device, uint32_t object)',
  upload:
    'int LIBMTP_Send_File_From_File(void *device, const char *path, void *file, RelayProgress *progress, const void *data)',
  download:
    'int LIBMTP_Get_File_To_File_Descriptor(void *device, uint32_t object, int fd, RelayProgress *progress, const void *data)',
} as const;
export type NativeOperation = keyof typeof definitions;
export class LibmtpBindings {
  readonly library: koffi.LibraryHandle;
  private functions: Record<NativeOperation, ReturnType<koffi.LibraryHandle['func']>>;
  private libc = koffi.load('/usr/lib/libSystem.B.dylib');
  private duplicate = this.libc.func('void *strdup(const char *text)');
  constructor(file: string) {
    this.library = koffi.load(file);
    this.functions = Object.fromEntries(
      Object.entries(definitions).map(([key, value]) => [key, this.library.func(value)]),
    ) as Record<NativeOperation, ReturnType<koffi.LibraryHandle['func']>>;
    this.sync('init');
  }
  sync<T = unknown>(operation: NativeOperation, ...args: unknown[]): T {
    return this.functions[operation](...args) as T;
  }
  call<T = unknown>(operation: NativeOperation, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) =>
      this.functions[operation].async(...args, (error: unknown, value: T) => {
        if (error) reject(error);
        else resolve(value);
      }),
    );
  }
  strdup(value: string): Address {
    return this.duplicate(value) as Address;
  }
  text(pointer: Address): string {
    return pointer ? (koffi.decode(pointer, 'char', -1) as string) : '';
  }
  decode<T>(pointer: Address, type: koffi.TypeObject): T {
    return koffi.decode(pointer, type) as T;
  }
}
