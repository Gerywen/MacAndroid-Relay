#include "libmtp.h"
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int allocations,fail_download,bad_name;
typedef struct {uint32_t id,parent;char *name;char *data;size_t size;int folder,active;} object;
static object objects[128];
static unsigned length;
static void reset(void){for(unsigned i=0;i<length;i++){free(objects[i].name);free(objects[i].data);}memset(objects,0,sizeof(objects));length=2;objects[0]=(object){1,0,strdup("文件.txt"),strdup("data"),4,0,1};objects[1]=(object){2,0,strdup("目录"),NULL,0,1,1};}
static object *find(uint32_t id){for(unsigned i=0;i<length;i++)if(objects[i].active&&objects[i].id==id)return &objects[i];return NULL;}
void LIBMTP_Init(void){}
LIBMTP_error_number_t LIBMTP_Detect_Raw_Devices(LIBMTP_raw_device_t **raw,int *count){*raw=calloc(1,sizeof(**raw));*count=1;return LIBMTP_ERROR_NONE;}
LIBMTP_mtpdevice_t *LIBMTP_Open_Raw_Device_Uncached(LIBMTP_raw_device_t *raw){reset();LIBMTP_mtpdevice_t *device=calloc(1,sizeof(*device));device->storage=calloc(1,sizeof(*device->storage));device->storage->id=1;device->storage->MaxCapacity=100000;device->storage->FreeSpaceInBytes=90000;device->storage->StorageDescription=strdup("Test storage");return device;}
void LIBMTP_Clear_Errorstack(LIBMTP_mtpdevice_t *device){while(device->errorstack){LIBMTP_error_t *error=device->errorstack;device->errorstack=error->next;free(error->error_text);free(error);}}
LIBMTP_error_t *LIBMTP_Get_Errorstack(LIBMTP_mtpdevice_t *device){return device->errorstack;}
static void error(LIBMTP_mtpdevice_t *device){LIBMTP_Clear_Errorstack(device);device->errorstack=calloc(1,sizeof(*device->errorstack));device->errorstack->errornumber=LIBMTP_ERROR_GENERAL;device->errorstack->error_text=strdup("Injected transfer failure");}
void LIBMTP_Release_Device(LIBMTP_mtpdevice_t *device){LIBMTP_Clear_Errorstack(device);free(device->storage->StorageDescription);free(device->storage);free(device);for(unsigned i=0;i<length;i++){free(objects[i].name);free(objects[i].data);}length=0;}
char *LIBMTP_Get_Manufacturername(LIBMTP_mtpdevice_t *device){return strdup("Test");}
char *LIBMTP_Get_Modelname(LIBMTP_mtpdevice_t *device){return strdup("Independent MTP fixture");}
char *LIBMTP_Get_Serialnumber(LIBMTP_mtpdevice_t *device){return strdup("123");}
void LIBMTP_FreeMemory(void *value){free(value);}
int LIBMTP_Get_Storage(LIBMTP_mtpdevice_t *device,int sort){return 0;}
LIBMTP_file_t *LIBMTP_new_file_t(void){allocations++;return calloc(1,sizeof(LIBMTP_file_t));}
void LIBMTP_destroy_file_t(LIBMTP_file_t *file){if(file){allocations--;free(file->filename);free(file);}}
static LIBMTP_file_t *metadata(object *entry){if(!entry)return NULL;LIBMTP_file_t *file=LIBMTP_new_file_t();file->item_id=entry->id;file->parent_id=entry->parent;file->storage_id=1;file->filename=strdup(bad_name?"../escape":entry->name);file->filesize=entry->size;file->filetype=entry->folder?LIBMTP_FILETYPE_FOLDER:LIBMTP_FILETYPE_UNKNOWN;return file;}
LIBMTP_file_t *LIBMTP_Get_Filemetadata(LIBMTP_mtpdevice_t *device,uint32_t id){return metadata(find(id));}
LIBMTP_file_t *LIBMTP_Get_Files_And_Folders(LIBMTP_mtpdevice_t *device,uint32_t storage,uint32_t parent){if(parent==LIBMTP_FILES_AND_FOLDERS_ROOT)parent=0;LIBMTP_file_t *head=NULL,**tail=&head;for(unsigned i=0;i<length;i++)if(objects[i].active&&objects[i].parent==parent){*tail=metadata(&objects[i]);tail=&(*tail)->next;}return head;}
uint32_t LIBMTP_Create_Folder(LIBMTP_mtpdevice_t *device,char *name,uint32_t parent,uint32_t storage){if(parent==0){error(device);return 0;}if(parent==LIBMTP_FILES_AND_FOLDERS_ROOT)parent=0;if(length>=128)return 0;unsigned index=length++;objects[index]=(object){index+1,parent,strdup(name),NULL,0,1,1};return index+1;}
int LIBMTP_Set_File_Name(LIBMTP_mtpdevice_t *device,LIBMTP_file_t *file,const char *name){object *entry=find(file->item_id);if(!entry)return -1;free(entry->name);entry->name=strdup(name);free(file->filename);file->filename=strdup(name);return 0;}
int LIBMTP_Delete_Object(LIBMTP_mtpdevice_t *device,uint32_t id){object *entry=find(id);if(!entry)return -1;entry->active=0;return 0;}
int LIBMTP_Send_File_From_File(LIBMTP_mtpdevice_t *device,const char *source,LIBMTP_file_t *file,LIBMTP_progressfunc_t progress,const void *data){if(length>=128)return -1;FILE *input=fopen(source,"rb");if(!input)return -1;unsigned index=length++;char *bytes=malloc(file->filesize+1);size_t count=fread(bytes,1,file->filesize,input);fclose(input);objects[index]=(object){index+1,file->parent_id==LIBMTP_FILES_AND_FOLDERS_ROOT?0:file->parent_id,strdup(file->filename),bytes,count,0,1};file->item_id=index+1;if(progress(count,count,data)){error(device);return -1;}return 0;}
int LIBMTP_Get_File_To_File_Descriptor(LIBMTP_mtpdevice_t *device,uint32_t id,int fd,LIBMTP_progressfunc_t progress,const void *data){object *entry=find(id);if(!entry)return -1;if(fail_download){write(fd,"bad",3);error(device);return -1;}if(write(fd,entry->data,entry->size)!=(ssize_t)entry->size)return -1;if(progress(entry->size,entry->size,data)){error(device);return -1;}return 0;}
int FixtureAllocations(void){return allocations;}
void FixtureFailDownload(int flag){fail_download=flag;}
void FixtureBadName(int flag){bad_name=flag;}
size_t SizeFile(void){return sizeof(LIBMTP_file_t);}
size_t SizeRaw(void){return sizeof(LIBMTP_raw_device_t);}
size_t SizeStorage(void){return sizeof(LIBMTP_devicestorage_t);}
size_t SizeError(void){return sizeof(LIBMTP_error_t);}
size_t OffsetStorage(void){return offsetof(LIBMTP_mtpdevice_t,storage);}
size_t OffsetFilename(void){return offsetof(LIBMTP_file_t,filename);}
size_t OffsetFilesize(void){return offsetof(LIBMTP_file_t,filesize);}
size_t OffsetNext(void){return offsetof(LIBMTP_file_t,next);}
int UnknownFiletype(void){return LIBMTP_FILETYPE_UNKNOWN;}
