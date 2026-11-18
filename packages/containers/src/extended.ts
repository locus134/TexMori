import { capabilities, type CodecId } from "../../core/src/index";
import { levelBytes, type TextureInfo } from "./texture";
const ktxMagic = Buffer.from("ab4b5458203131bb0d0a1a0a", "hex");
const ktx2Magic = Buffer.from("ab4b5458203230bb0d0a1a0a", "hex");
const glFormats: Record<number, CodecId> = {
  36196:"etc1",37488:"etc2_r",37490:"etc2_rg",37492:"etc2_rgb",37493:"etc2_rgb",37496:"etc2_rgba",37497:"etc2_rgba",
  33776:"bc1",33777:"bc1",35916:"bc1",35917:"bc1",33779:"bc3",35919:"bc3",36283:"bc4",36285:"bc5",36492:"bc7",36493:"bc7",
  35841:"pvrtc1_rgb_2",35843:"pvrtc1_rgba_2",35840:"pvrtc1_rgb_4",35842:"pvrtc1_rgba_4",37175:"pvrtc2_2",37176:"pvrtc2_4",
  35412:"pvrtc1_rgb_2",35413:"pvrtc1_rgb_4",35414:"pvrtc1_rgba_2",35415:"pvrtc1_rgba_4",37872:"pvrtc2_2",37873:"pvrtc2_4",
};
const vkFormats: Record<number, CodecId> = {
  131:"bc1",132:"bc1",133:"bc1",134:"bc1",137:"bc3",138:"bc3",139:"bc4",141:"bc5",145:"bc7",146:"bc7",
  147:"etc2_rgb",148:"etc2_rgb",151:"etc2_rgba",152:"etc2_rgba",153:"etc2_r",155:"etc2_rg",
  1000054000:"pvrtc1_rgba_2",1000054001:"pvrtc1_rgba_4",1000054002:"pvrtc2_2",1000054003:"pvrtc2_4",
  1000054004:"pvrtc1_rgba_2",1000054005:"pvrtc1_rgba_4",1000054006:"pvrtc2_2",1000054007:"pvrtc2_4",
};
for (const c of capabilities.filter(c=>c.id.startsWith("astc_"))) {
  const n=c.pvrFormat-27;
  glFormats[0x93b0+n]=glFormats[0x93d0+n]=c.id;
  vkFormats[157+n*2]=vkFormats[158+n*2]=c.id;
}
export function isExtendedTexture(data: Buffer) {
  return data.subarray(0,12).equals(ktxMagic) || data.subarray(0,12).equals(ktx2Magic) || (data.length>=4 && data.readUInt32LE(0)===0x5ca1ab13);
}
export function inspectExtended(data: Buffer): TextureInfo {
  let container: TextureInfo["container"], codec: CodecId | undefined, width: number, height: number, mipmaps=1, dataOffset=0, payloadBytes=0;
  let colorSpace: "linear"|"srgb"="linear";
  const requireBytes=(offset:number,size:number)=>{
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>data.length) throw Error("纹理文件截断或偏移无效");
  };
  if(data.subarray(0,12).equals(ktxMagic)) {
    container="ktx"; requireBytes(0,64);
    if(data.readUInt32LE(12)!==0x04030201) throw Error("不支持大端 KTX");
    if(data.readUInt32LE(16)!==0 || data.readUInt32LE(24)!==0 || data.readUInt32LE(44)>1 || data.readUInt32LE(48)>1 || data.readUInt32LE(52)!==1) throw Error("仅支持普通 2D 压缩 KTX");
    const format=data.readUInt32LE(28); codec=glFormats[format];
    colorSpace=([37493,37497,35916,35917,35919,36493,35412,35413,35414,35415,37872,37873].includes(format)||(format>=0x93d0&&format<=0x93dd))?"srgb":"linear";
    width=data.readUInt32LE(36);height=data.readUInt32LE(40);mipmaps=Math.max(1,data.readUInt32LE(56));dataOffset=64+data.readUInt32LE(60);
  } else if(data.subarray(0,12).equals(ktx2Magic)) {
    container="ktx2";requireBytes(0,80);
    const format=data.readUInt32LE(12);codec=vkFormats[format];
    colorSpace=([132,134,138,146,148,152].includes(format)||(format>=158&&format<=184&&format%2===0)||format>=1000054004)?"srgb":"linear";
    width=data.readUInt32LE(20);height=data.readUInt32LE(24);mipmaps=Math.max(1,data.readUInt32LE(40));
    if(data.readUInt32LE(28)>1||data.readUInt32LE(32)>1||data.readUInt32LE(36)!==1||data.readUInt32LE(44)!==0) throw Error("仅支持未超压缩的普通 2D KTX2");
    requireBytes(80,mipmaps*24);
  } else {
    container="astc";requireBytes(0,16);
    if(data.readUInt32LE(0)!==0x5ca1ab13||data[6]!==1||data.readUIntLE(13,3)!==1)throw Error("仅支持 2D ASTC");
    codec=capabilities.find(c=>c.blockWidth===data[4]&&c.blockHeight===data[5])?.id;
    width=data.readUIntLE(7,3);height=data.readUIntLE(10,3);dataOffset=16;
  }
  if(!codec)throw Error("不支持的纹理编码格式");
  if(!width||!height||width>16384||height>16384||mipmaps>1+Math.floor(Math.log2(Math.max(width,height))))throw Error("纹理尺寸或 Mip 层数无效");
  let cursor=dataOffset;
  const ranges: Array<[number, number]> = [];
  for(let i=0;i<mipmaps;i++) {
    const size=levelBytes(codec,Math.max(1,Math.floor(width/2**i)),Math.max(1,Math.floor(height/2**i)));
    if(container==="ktx") {
      requireBytes(cursor,4);if(data.readUInt32LE(cursor)!==size)throw Error("KTX Mip 有效负载长度不匹配");
      cursor+=4;requireBytes(cursor,size);if(i===0)dataOffset=cursor;cursor+=Math.ceil(size/4)*4;
    } else if(container==="ktx2") {
      const entry=80+i*24,offset=Number(data.readBigUInt64LE(entry)),length=Number(data.readBigUInt64LE(entry+8));
      if(length!==size||data.readBigUInt64LE(entry+16)!==BigInt(size))throw Error("KTX2 Mip 有效负载长度不匹配");
      if(offset<80+mipmaps*24)throw Error("KTX2 Mip 偏移无效");
      requireBytes(offset,size);
      if (ranges.some(([start,end])=>offset<end && offset+size>start)) throw Error("KTX2 Mip 数据重叠");
      ranges.push([offset,offset+size]);
      if(i===0)dataOffset=offset;
    } else {requireBytes(16,size);if(data.length!==16+size)throw Error("ASTC 有效负载长度不匹配");}
    payloadBytes+=size;
  }
  if(container==="ktx"&&cursor!==data.length)throw Error("KTX 文件长度不匹配");
  return {container,codec,width,height,encodedWidth:width,encodedHeight:height,mipmaps,dataOffset,payloadBytes,colorSpace,premultiplied:false};
}

// KTX has per-level length words; reconstruct contiguous PVR payloads for CPU decoding.
export function extendedToPvr(data: Buffer): Buffer {
  const info=inspectExtended(data), c=capabilities.find(c=>c.id===info.codec)!;
  const parts: Buffer[]=[];
  let cursor=info.dataOffset;
  for(let i=0;i<info.mipmaps;i++) {
    const size=levelBytes(info.codec,Math.max(1,Math.floor(info.width/2**i)),Math.max(1,Math.floor(info.height/2**i)));
    const offset=info.container==="ktx2"?Number(data.readBigUInt64LE(80+i*24)):cursor;
    parts.push(data.subarray(offset,offset+size));
    cursor+=size+(info.container==="ktx"?4:0);
  }
  const header=Buffer.alloc(52);header.writeUInt32LE(0x03525650);header.writeUInt32LE(c.pvrFormat,8);
  header.writeUInt32LE(info.colorSpace==="srgb"?1:0,16);header.writeUInt32LE(info.height,24);header.writeUInt32LE(info.width,28);
  for(const offset of [32,36,40])header.writeUInt32LE(1,offset);header.writeUInt32LE(info.mipmaps,44);
  return Buffer.concat([header,...parts]);
}
export function writeBc7Ktx(pvr: Buffer, ktx2: boolean): Buffer {
  const width=pvr.readUInt32LE(28),height=pvr.readUInt32LE(24),mips=pvr.readUInt32LE(44),srgb=pvr.readUInt32LE(16)===1;
  const payload=pvr.subarray(52+pvr.readUInt32LE(48));
  const sizes=Array.from({length:mips},(_,i)=>levelBytes("bc7",Math.max(1,Math.floor(width/2**i)),Math.max(1,Math.floor(height/2**i))));
  if(!ktx2) {
    const h=Buffer.alloc(64);ktxMagic.copy(h);h.writeUInt32LE(0x04030201,12);h.writeUInt32LE(1,20);
    h.writeUInt32LE(srgb?36493:36492,28);h.writeUInt32LE(0x1908,32);h.writeUInt32LE(width,36);h.writeUInt32LE(height,40);h.writeUInt32LE(1,52);h.writeUInt32LE(mips,56);
    let offset=0;const levels=sizes.flatMap(size=>{const length=Buffer.alloc(4);length.writeUInt32LE(size);const data=payload.subarray(offset,offset+size);offset+=size;return [length,data];});
    return Buffer.concat([h,...levels]);
  }
  const dfdOffset=80+24*mips,dfdSize=44,dataOffset=Math.ceil((dfdOffset+dfdSize)/16)*16;
  const h=Buffer.alloc(dataOffset);ktx2Magic.copy(h);h.writeUInt32LE(srgb?146:145,12);h.writeUInt32LE(1,16);
  h.writeUInt32LE(width,20);h.writeUInt32LE(height,24);h.writeUInt32LE(1,36);h.writeUInt32LE(mips,40);h.writeUInt32LE(dfdOffset,48);h.writeUInt32LE(dfdSize,52);
  h.writeUInt32LE(44,dfdOffset);h.writeUInt16LE(2,dfdOffset+8);h.writeUInt16LE(40,dfdOffset+10);
  h[dfdOffset+12]=134;h[dfdOffset+13]=1;h[dfdOffset+14]=srgb?2:1;h[dfdOffset+16]=3;h[dfdOffset+17]=3;h[dfdOffset+20]=16;
  h[dfdOffset+30]=127;h.writeUInt32LE(0xffffffff,dfdOffset+40);
  let offset=dataOffset;
  for(let i=0;i<mips;i++){h.writeBigUInt64LE(BigInt(offset),80+i*24);h.writeBigUInt64LE(BigInt(sizes[i]),88+i*24);h.writeBigUInt64LE(BigInt(sizes[i]),96+i*24);offset+=sizes[i];}
  return Buffer.concat([h,payload]);
}
