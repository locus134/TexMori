import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.join(root,'build/cocos-reference');
await mkdir(directory,{recursive:true});
const commit=execFileSync('git',['ls-remote','https://github.com/cocos2d/cocos2d-x.git','refs/heads/v3'],{encoding:'utf8'}).split(/\s/)[0];
if(!/^[0-9a-f]{40}$/.test(commit))throw Error('Cannot resolve Cocos reference');
const response=await fetch(`https://raw.githubusercontent.com/cocos2d/cocos2d-x/${commit}/cocos/base/ZipUtils.cpp`);
if(!response.ok)throw Error(`Cocos source: ${response.status}`);
const source=await response.text();await writeFile(path.join(directory,'ZipUtils.cpp'),source);
const functions=['inline void ZipUtils::decodeEncodedPvr','inline unsigned int ZipUtils::checksumPvr','int ZipUtils::inflateCCZBuffer','void ZipUtils::setPvrEncryptionKeyPart','void ZipUtils::setPvrEncryptionKey('].map(signature=>{
 const start=source.indexOf(signature),end=source.indexOf('\n}',start);if(start<0||end<0)throw Error(`Missing reference: ${signature}`);return source.slice(start,end+2);
}).join('\n\n');
const stub=`${source.slice(0,source.indexOf('#include'))}
#include <zlib.h>
#include <cassert>
#include <cstdlib>
#include <cstdint>
#include <vector>
#include <fstream>
#include <iterator>
#include <string>
#define CCASSERT(condition,message) assert(condition)
#define CCLOG(...) ((void)0)
#define CC_SWAP_INT16_BIG_TO_HOST(v) __builtin_bswap16(v)
#define CC_SWAP_INT32_BIG_TO_HOST(v) __builtin_bswap32(v)
#define CCZ_COMPRESSION_ZLIB 0
#define COCOS2D_DEBUG 1
struct CCZHeader { char sig[4]; uint16_t compression_type; uint16_t version; uint32_t reserved; uint32_t len; };
class ZipUtils { public:
static unsigned int s_uEncryptedPvrKeyParts[4],s_uEncryptionKey[1024];static bool s_bEncryptionKeyIsValid;
static void decodeEncodedPvr(unsigned int*,ssize_t);static unsigned int checksumPvr(const unsigned int*,ssize_t);
static int inflateCCZBuffer(const unsigned char*,ssize_t,unsigned char**);
static void setPvrEncryptionKeyPart(int,unsigned int);static void setPvrEncryptionKey(unsigned int,unsigned int,unsigned int,unsigned int);
};
unsigned int ZipUtils::s_uEncryptedPvrKeyParts[4]={0,0,0,0};
unsigned int ZipUtils::s_uEncryptionKey[1024];bool ZipUtils::s_bEncryptionKeyIsValid=false;
${functions}
int main(int argc,char**argv){
 if(argc!=3&&argc!=4)return 2;
 if(argc==4){std::string key=argv[3];if(key.size()!=32)return 3;for(int i=0;i<4;i++)ZipUtils::setPvrEncryptionKeyPart(i,std::stoul(key.substr(i*8,8),nullptr,16));}
 std::ifstream in(argv[1],std::ios::binary);std::vector<unsigned char>data((std::istreambuf_iterator<char>(in)),{});if(data.size()<16)return 4;
 unsigned char*out=nullptr;int length=ZipUtils::inflateCCZBuffer(data.data(),data.size(),&out);if(length<0)return 5;
 std::ofstream file(argv[2],std::ios::binary);file.write(reinterpret_cast<char*>(out),length);free(out);return file.good()?0:6;
}
`;
await writeFile(path.join(directory,'verify-cocos.cpp'),stub);
execFileSync('clang++',['-std=c++17','-O2',path.join(directory,'verify-cocos.cpp'),'-lz','-o',path.join(directory,'verify-cocos')],{stdio:'inherit'});
await writeFile(path.join(directory,'provenance.json'),JSON.stringify({repository:'https://github.com/cocos2d/cocos2d-x',commit,extraction:'Unmodified decodeEncodedPvr, checksumPvr, inflateCCZBuffer and key setters; stubbed platform/logging only; COCOS2D_DEBUG=1. Not a full graphics-engine runtime.'},null,2));
console.log('Cocos ZipUtils reference verifier compiled: '+commit);
