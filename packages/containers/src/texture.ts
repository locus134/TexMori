import { capabilities, capability, type CodecId } from '../../core/src/index';
export interface TextureInfo {container:'pkm'|'pvr'|'dds';codec:CodecId;width:number;height:number;encodedWidth:number;encodedHeight:number;mipmaps:number;dataOffset:number;payloadBytes:number;colorSpace:'srgb'|'linear';premultiplied:boolean}
function dimensions(w:number,h:number,mips=1) {if(!w||!h||w>16384||h>16384||mips<1||mips>1+Math.floor(Math.log2(Math.max(w,h))))throw Error('纹理尺寸或 Mip 层数无效');}
export function levelBytes(codec:CodecId,w:number,h:number) {
  const c=capability(codec);
  if(codec.startsWith('pvrtc1'))return Math.max(w,c.bpp===2?16:8)*Math.max(h,8)*c.bpp/8;
  const bw=c.engine==='pvrtc'&&c.bpp===2?8:4;
  return Math.ceil(w/bw)*Math.ceil(h/4)*(bw*4*c.bpp/8);
}
function payloadBytes(codec:CodecId,w:number,h:number,mips:number) {let total=0;for(let i=0;i<mips;i++){total+=levelBytes(codec,w,h);w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}return total;}
export function readPkm(data:Buffer):TextureInfo {
  if(data.length<16)throw Error('PKM 文件截断');
  const magic=data.subarray(0,6).toString();if(!['PKM 10','PKM 20'].includes(magic))throw Error('PKM 签名无效');
  const format=data.readUInt16BE(6),c=capabilities.find(c=>c.pkmFormat===format);
  if(!c||(magic==='PKM 10'&&format!==0))throw Error('PKM 编码格式不支持');
  const ew=data.readUInt16BE(8),eh=data.readUInt16BE(10),w=data.readUInt16BE(12),h=data.readUInt16BE(14);
  dimensions(w,h);if(ew!==Math.ceil(w/4)*4||eh!==Math.ceil(h/4)*4)throw Error('PKM 逻辑尺寸与编码尺寸不匹配');
  const bytes=payloadBytes(c.id,ew,eh,1);if(data.length!==16+bytes)throw Error('PKM 有效负载长度不匹配');
  return {container:'pkm',codec:c.id,width:w,height:h,encodedWidth:ew,encodedHeight:eh,mipmaps:1,dataOffset:16,payloadBytes:bytes,colorSpace:'linear',premultiplied:false};
}
export function writePkm(codec:CodecId,w:number,h:number,ew:number,eh:number,payload:Buffer) {
  const c=capability(codec);if(c.pkmFormat===undefined)throw Error('编码无法保存为 PKM');
  const header=Buffer.alloc(16);header.write(codec==='etc1'?'PKM 10':'PKM 20');header.writeUInt16BE(c.pkmFormat,6);header.writeUInt16BE(ew,8);header.writeUInt16BE(eh,10);header.writeUInt16BE(w,12);header.writeUInt16BE(h,14);
  const data=Buffer.concat([header,payload]);readPkm(data);return data;
}
export function makePvr(codec:CodecId,w:number,h:number,payload:Buffer,colorSpace:'srgb'|'linear'='linear') {
  const header=Buffer.alloc(52);header.writeUInt32LE(0x03525650);header.writeUInt32LE(capability(codec).pvrFormat,8);header.writeUInt32LE(colorSpace==='srgb'?1:0,16);header.writeUInt32LE(h,24);header.writeUInt32LE(w,28);for(const p of [32,36,40,44])header.writeUInt32LE(1,p);return Buffer.concat([header,payload]);
}
export function pkmToPvr(data:Buffer) {const i=readPkm(data);return makePvr(i.codec,i.encodedWidth,i.encodedHeight,data.subarray(16));}
export function inspectTexture(data:Buffer):TextureInfo {
  if(data.subarray(0,4).toString()==='PKM ')return readPkm(data);
  let container:'pvr'|'dds',codec:CodecId,w:number,h:number,mips:number,offset:number,colorSpace:'srgb'|'linear'='linear',premultiplied=false;
  if(data.length>=52&&data.readUInt32LE(0)===0x03525650) {
    container='pvr';if(data.readUInt32LE(12)!==0)throw Error('不支持未压缩 PVR');
    const c=capabilities.find(c=>c.pvrFormat===data.readUInt32LE(8));if(!c)throw Error('不支持的 PVR 编码');codec=c.id;
    h=data.readUInt32LE(24);w=data.readUInt32LE(28);mips=data.readUInt32LE(44);offset=52+data.readUInt32LE(48);
    if(data.readUInt32LE(32)!==1||data.readUInt32LE(36)!==1||data.readUInt32LE(40)!==1)throw Error('首期仅支持普通 2D 纹理，不支持数组、立方体或 3D');
    if(data.readUInt32LE(16)>1||data.readUInt32LE(20)!==0)throw Error('不支持的色彩空间或有符号通道类型');
    colorSpace=data.readUInt32LE(16)===1?'srgb':'linear';premultiplied=!!(data.readUInt32LE(4)&2);
  } else if(data.length>=128&&data.subarray(0,4).toString()==='DDS ') {
    container='dds';if(data.readUInt32LE(4)!==124||data.readUInt32LE(76)!==32)throw Error('DDS 头无效');
    h=data.readUInt32LE(12);w=data.readUInt32LE(16);mips=Math.max(1,data.readUInt32LE(28));offset=128;
    if(data.readUInt32LE(112)!==0||data.readUInt32LE(24)>1)throw Error('首期仅支持普通 2D DDS');
    const fourcc=data.subarray(84,88).toString();
    const legacy:Record<string,CodecId>={DXT1:'bc1',DXT5:'bc3',ATI1:'bc4',BC4U:'bc4',ATI2:'bc5',BC5U:'bc5'};
    if(fourcc==='DX10') {
      if(data.length<148||data.readUInt32LE(132)!==3||data.readUInt32LE(140)!==1||(data.readUInt32LE(136)&4))throw Error('不支持此 DDS DX10 结构');
      const dxgi=data.readUInt32LE(128),formats:Record<number,CodecId>={71:'bc1',72:'bc1',77:'bc3',78:'bc3',80:'bc4',83:'bc5',98:'bc7',99:'bc7'};
      codec=formats[dxgi];colorSpace=[72,78,99].includes(dxgi)?'srgb':'linear';offset=148;
    }else codec=legacy[fourcc];
    if(!codec)throw Error('DDS 编码不支持');
  }else throw Error('无法识别或文件头已损坏');
  dimensions(w,h,mips);
  const bytes=payloadBytes(codec,w,h,mips);if(offset>data.length||offset+bytes!==data.length)throw Error('纹理有效负载长度不匹配');
  return {container,codec,width:w,height:h,encodedWidth:w,encodedHeight:h,mipmaps:mips,dataOffset:offset,payloadBytes:bytes,colorSpace,premultiplied};
}
