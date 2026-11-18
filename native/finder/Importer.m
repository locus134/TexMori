#import <CoreFoundation/CFPlugInCOM.h>
#import <CoreServices/CoreServices.h>
#import "TextureMetadata.h"
#define TM_FACTORY_UUID CFSTR("B9CFCCEB-B90C-46B8-9CD7-A4B87BD05D23")
typedef struct {MDImporterInterfaceStruct *interface;CFUUIDRef factory;ULONG references;} TMImporter;
static ULONG AddRef(void *value){return ++((TMImporter *)value)->references;}
static ULONG Release(void *value){TMImporter *instance=value;if(--instance->references)return instance->references;CFPlugInRemoveInstanceForFactory(instance->factory);CFRelease(instance->factory);free(instance);return 0;}
static HRESULT QueryInterface(void *value,REFIID iid,LPVOID *result){CFUUIDRef interface=CFUUIDCreateFromUUIDBytes(NULL,iid);BOOL supported=CFEqual(interface,kMDImporterInterfaceID)||CFEqual(interface,IUnknownUUID);CFRelease(interface);if(supported){AddRef(value);*result=value;return S_OK;}*result=NULL;return E_NOINTERFACE;}
static Boolean ImportFile(void *instance,CFMutableDictionaryRef attributes,CFStringRef uti,CFStringRef file){@autoreleasepool{NSDictionary *values=TMReadTextureMetadata((__bridge NSString *)file);if(!values)return false;[(__bridge NSMutableDictionary *)attributes addEntriesFromDictionary:values];return true;}}
static MDImporterInterfaceStruct TMInterface={NULL,QueryInterface,AddRef,Release,ImportFile};
__attribute__((visibility("default"))) void *MetadataImporterPluginFactory(CFAllocatorRef allocator,CFUUIDRef type){if(!CFEqual(type,kMDImporterTypeID))return NULL;TMImporter *instance=calloc(1,sizeof(TMImporter));instance->interface=&TMInterface;instance->references=1;instance->factory=CFUUIDCreateFromString(NULL,TM_FACTORY_UUID);CFPlugInAddInstanceForFactory(instance->factory);return instance;}
