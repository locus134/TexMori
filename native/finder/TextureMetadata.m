#import "TextureMetadata.h"
#include <sys/xattr.h>
#include <zlib.h>
#include "TexMoriCodecs.h"

static uint16_t BE16(const uint8_t *p){return (uint16_t)((p[0]<<8)|p[1]);}
static uint32_t LE32(const uint8_t *p){return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);}
static uint32_t BE32(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static const TMCodec *ByPVR(uint32_t id){for(size_t i=0;i<TMCodecCount;i++)if(TMCodecs[i].pvr==id)return &TMCodecs[i];return NULL;}
static const TMCodec *ByPKM(uint32_t id){for(size_t i=0;i<TMCodecCount;i++)if(TMCodecs[i].pkm==(int)id)return &TMCodecs[i];return NULL;}
static uint64_t LevelBytes(const TMCodec *c,uint32_t w,uint32_t h){
  if(strncmp(c->id,"pvrtc1",6)==0)return (uint64_t)MAX(w,c->bpp==2?16:8)*MAX(h,8)*c->bpp/8;
  uint32_t blockW=strncmp(c->id,"pvrtc2",6)==0&&c->bpp==2?8:4;
  return (uint64_t)((w+blockW-1)/blockW)*((h+3)/4)*(blockW*4*c->bpp/8);
}
static NSMutableDictionary *Values(const TMCodec *c,NSString *container){
  NSString *label=@(c->label),*channels=@(c->channels);
  return [@{@"com_texmori_codec":label,@"com_texmori_channels":channels,@"com_texmori_container":container,@"com_texmori_bitsPerPixel":@(c->bpp),@"kMDItemCodecs":@[label],@"kMDItemHasAlphaChannel":@([channels containsString:@"A"]),@"kMDItemKind":[NSString stringWithFormat:@"%@ texture (%@)",label,container]} mutableCopy];
}
NSDictionary<NSString *, id> *TMReadTextureMetadata(NSString *file){
  @autoreleasepool{
    NSDictionary *attributes=[[NSFileManager defaultManager] attributesOfItemAtPath:file error:nil];
    uint64_t fileSize=[attributes[NSFileSize] unsignedLongLongValue];
    if(fileSize<16||fileSize>256ULL*1024*1024)return nil;
    NSData *mapped=[NSData dataWithContentsOfFile:file options:NSDataReadingMappedIfSafe error:nil];
    if(!mapped||mapped.length<16||mapped.length>256ULL*1024*1024)return nil;
    const uint8_t *p=mapped.bytes;size_t available=mapped.length;uint64_t length=available;
    uint8_t inflated[256];BOOL ccz=memcmp(p,"CCZ!",4)==0;
    if(memcmp(p,"CCZp",4)==0){
      char value[128]={0};ssize_t count=getxattr(file.fileSystemRepresentation,"com.texmori.codec",value,sizeof(value)-1,0,0);
      if(count<=0)count=getxattr(file.fileSystemRepresentation,"com.cptool.codec",value,sizeof(value)-1,0,0);
      for(size_t i=0;count>0&&i<TMCodecCount;i++)if(strcmp(value,TMCodecs[i].id)==0){NSMutableDictionary *result=Values(&TMCodecs[i],@"PVR.CCZ (encrypted)");result[@"com_texmori_metadataSource"]=@"Export record (encrypted content)";return result;}
      return @{@"com_texmori_container":@"PVR.CCZ (encrypted)",@"com_texmori_codec":@"Encrypted — key required",@"com_texmori_channels":@"Unknown",@"com_texmori_metadataSource":@"Encrypted header"};
    }
    if(ccz){
      if(BE16(p+4)!=0||BE16(p+6)>2||available<=16)return nil;
      length=BE32(p+12);if(length<52||length>256ULL*1024*1024)return nil;
      z_stream stream={0};stream.next_in=(Bytef *)(p+16);stream.avail_in=(uInt)(available-16);stream.next_out=inflated;stream.avail_out=sizeof(inflated);
      if(inflateInit(&stream)!=Z_OK)return nil;int status=inflate(&stream,Z_NO_FLUSH);available=stream.total_out;inflateEnd(&stream);
      if((status!=Z_OK&&status!=Z_STREAM_END)||available<52)return nil;p=inflated;
    }
    const TMCodec *codec=NULL;NSString *container=nil;uint32_t w=0,h=0,ew=0,eh=0,mips=1;uint64_t offset=0;
    if(available>=16&&(memcmp(p,"PKM 10",6)==0||memcmp(p,"PKM 20",6)==0)){
      uint16_t format=BE16(p+6);codec=ByPKM(format);if(!codec||(p[4]=='1'&&format!=0))return nil;
      container=p[4]=='1'?@"PKM 1.0":@"PKM 2.0";ew=BE16(p+8);eh=BE16(p+10);w=BE16(p+12);h=BE16(p+14);offset=16;
      if(ew!=(w+3)/4*4||eh!=(h+3)/4*4)return nil;
    }else if(available>=52&&LE32(p)==0x03525650){
      codec=ByPVR(LE32(p+8));if(!codec||LE32(p+12)||LE32(p+16)>1||LE32(p+20)!=0||LE32(p+32)!=1||LE32(p+36)!=1||LE32(p+40)!=1)return nil;
      container=ccz?@"PVR.CCZ":@"PVR";w=ew=LE32(p+28);h=eh=LE32(p+24);mips=LE32(p+44);offset=52ULL+LE32(p+48);
      if(strncmp(codec->id,"pvrtc1",6)==0&&((w&(w-1))||(h&(h-1))))return nil;
      if(strcmp(codec->id,"pvrtc2_2")==0&&(w%8||h%4))return nil;
      if(strcmp(codec->id,"pvrtc2_4")==0&&(w%4||h%4))return nil;
    }else if(!ccz&&available>=128&&memcmp(p,"DDS ",4)==0){
      if(LE32(p+4)!=124||LE32(p+76)!=32||LE32(p+112)||LE32(p+24)>1)return nil;
      container=@"DDS";w=ew=LE32(p+16);h=eh=LE32(p+12);mips=MAX(1,LE32(p+28));offset=128;
      if(memcmp(p+84,"DXT1",4)==0)codec=ByPVR(7);else if(memcmp(p+84,"DXT5",4)==0)codec=ByPVR(11);
      else if(memcmp(p+84,"ATI1",4)==0||memcmp(p+84,"BC4U",4)==0)codec=ByPVR(12);
      else if(memcmp(p+84,"ATI2",4)==0||memcmp(p+84,"BC5U",4)==0)codec=ByPVR(13);
      else if(memcmp(p+84,"DX10",4)==0){if(available<148||LE32(p+132)!=3||LE32(p+140)!=1||(LE32(p+136)&4))return nil;offset=148;
        switch(LE32(p+128)){case 71:case 72:codec=ByPVR(7);break;case 77:case 78:codec=ByPVR(11);break;case 80:codec=ByPVR(12);break;case 83:codec=ByPVR(13);break;case 98:case 99:codec=ByPVR(15);break;default:return nil;}
      }
    }
    if(!codec||!w||!h||w>16384||h>16384||mips<1||mips>15||offset>length)return nil;
    uint32_t maxMips=1,maxSide=MAX(w,h);while(maxSide>1){maxSide>>=1;maxMips++;}if(mips>maxMips)return nil;
    uint64_t payload=0;uint32_t levelW=ew,levelH=eh;for(uint32_t i=0;i<mips;i++){payload+=LevelBytes(codec,levelW,levelH);levelW=MAX(1,levelW/2);levelH=MAX(1,levelH/2);}
    if(offset+payload!=length)return nil;
    NSMutableDictionary *result=Values(codec,container);result[@"kMDItemPixelWidth"]=@(w);result[@"kMDItemPixelHeight"]=@(h);result[@"com_texmori_encodedDimensions"]=[NSString stringWithFormat:@"%u × %u",ew,eh];result[@"com_texmori_mipLevels"]=@(mips);result[@"com_texmori_metadataSource"]=@"File header";return result;
  }
}
#ifdef TEXMORI_METADATA_CLI
int main(int argc,const char **argv){@autoreleasepool{if(argc!=2)return 2;NSDictionary *values=TMReadTextureMetadata(@(argv[1]));if(!values)return 1;NSData *json=[NSJSONSerialization dataWithJSONObject:values options:NSJSONWritingSortedKeys error:nil];fwrite(json.bytes,1,json.length,stdout);return 0;}}
#endif
