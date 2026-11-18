import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
const formats={etc1:[6,4],etc2_rgb:[22,4],etc2_rgba:[23,8],etc2_r:[25,4],etc2_rg:[26,8],bc1:[7,4],bc3:[11,8],bc4:[12,4],bc5:[13,8],bc7:[15,8],pvrtc1_rgb_2:[0,2],pvrtc1_rgba_2:[1,2],pvrtc1_rgb_4:[2,4],pvrtc1_rgba_4:[3,4],pvrtc2_2:[4,2],pvrtc2_4:[5,4]};
function fixture(id){const [format,bpp]=formats[id],data=Buffer.alloc(52+32*32*bpp/8);data.writeUInt32LE(0x03525650);data.writeUInt32LE(format,8);for(const offset of [24,28])data.writeUInt32LE(32,offset);for(const offset of [32,36,40,44])data.writeUInt32LE(1,offset);return data;}

const root=process.cwd(),binary=path.join(root,'build/finder-integration/inspect-texture');
const dir=path.join(root,'build/finder-integration/tests');await mkdir(dir,{recursive:true});
function inspect(file){const result=spawnSync(binary,[file],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,`Native metadata reader failed: ${result.error?.message??result.stderr}`);return JSON.parse(result.stdout);}
let passed=0;
for(const [id,type,label,channels,alpha,bpp] of [['etc1',0,'ETC1 RGB','RGB',false,4],['etc2_rgb',1,'ETC2 RGB','RGB',false,4],['etc2_rgba',3,'ETC2 RGBA','RGBA',true,8],['etc2_r',4,'EAC R11','R',false,4],['etc2_rg',5,'EAC RG11','RG',false,8]]){
 const pvr=fixture(id),header=Buffer.alloc(16);header.write(id==='etc1'?'PKM 10':'PKM 20');header.writeUInt16BE(type,6);for(const offset of [8,10,12,14])header.writeUInt16BE(32,offset);
 const file=path.join(dir,id+'.pkm');await writeFile(file,Buffer.concat([header,pvr.subarray(52+pvr.readUInt32LE(48))]));
 const metadata=inspect(file);assert.equal(metadata.com_texmori_codec,label);assert.equal(metadata.com_texmori_channels,channels);assert.equal(metadata.kMDItemHasAlphaChannel,alpha);assert.equal(metadata.kMDItemPixelWidth,32);assert.equal(metadata.com_texmori_bitsPerPixel,bpp);passed++;
}
for(const [id,label] of [['bc1','BC1 RGB'],['bc3','BC3 RGBA'],['bc4','BC4 R'],['bc5','BC5 RG'],['bc7','BC7 RGBA'],['pvrtc1_rgb_2','PVRTC1 RGB 2bpp'],['pvrtc1_rgba_2','PVRTC1 RGBA 2bpp'],['pvrtc1_rgb_4','PVRTC1 RGB 4bpp'],['pvrtc1_rgba_4','PVRTC1 RGBA 4bpp'],['pvrtc2_2','PVRTC2 2bpp'],['pvrtc2_4','PVRTC2 4bpp']]){const file=path.join(dir,id+".pvr");await writeFile(file,fixture(id));assert.equal(inspect(file).com_texmori_codec,label);passed++;}
for(const [id,fourcc,label] of [['bc1','DXT1','BC1 RGB'],['bc3','DXT5','BC3 RGBA'],['bc4','ATI1','BC4 R'],['bc5','ATI2','BC5 RG']]){const pvr=fixture(id),header=Buffer.alloc(128);header.write('DDS ');header.writeUInt32LE(124,4);header.writeUInt32LE(32,12);header.writeUInt32LE(32,16);header.writeUInt32LE(32,76);header.write(fourcc,84);const file=path.join(dir,id+'.dds');await writeFile(file,Buffer.concat([header,pvr.subarray(52)]));assert.equal(inspect(file).com_texmori_codec,label);passed++;}
const pvr=fixture('etc2_rgba'),cczHeader=Buffer.alloc(16);cczHeader.write('CCZ!');cczHeader.writeUInt16BE(2,6);cczHeader.writeUInt32BE(pvr.length,12);const cczFile=path.join(dir,'etc2_rgba.pvr.ccz');await writeFile(cczFile,Buffer.concat([cczHeader,deflateSync(pvr)]));assert.equal(inspect(cczFile).com_texmori_codec,'ETC2 RGBA');passed++;
const good=await readFile(path.join(dir,'etc1.pkm'));
for(const [name,data] of [['truncated',good.subarray(0,18)],['zero-size',Buffer.from(good)],['wrong-format',Buffer.from(good)]]){if(name==='zero-size')data.writeUInt16BE(0,12);if(name==='wrong-format')data.writeUInt16BE(99,6);const file=path.join(dir,name+'.pkm');await writeFile(file,data);assert.notEqual(spawnSync(binary,[file],{encoding:'utf8'}).status,0);passed++;}
console.log(`Finder native metadata: ${passed} cases passed (ETC1/ETC2, RGB/RGBA, all codecs and invalid headers).`);
