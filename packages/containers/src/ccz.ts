import { deflateSync, inflateSync } from 'node:zlib';
import { normalizeKey } from './keys';
const MAX_BYTES=256*1024*1024;
function schedule(key:string) {
  const parts=normalizeKey(key).match(/.{8}/g)!.map(x=>parseInt(x,16));
  const words=new Uint32Array(1024);
  let z=0,sum=0;
  for(let round=0;round<6;round++) {
    sum=(sum+0x9e3779b9)>>>0;const e=(sum>>>2)&3;
    for(let p=0;p<1024;p++) {
      const y=words[(p+1)%1024];
      const mx=(((z>>>5)^(y<<2))+((y>>>3)^(z<<4)))^((sum^y)+(parts[(p&3)^e]^z));
      z=words[p]=(words[p]+mx)>>>0;
    }
  }
  return words;
}
function checksum(data:Buffer):number {let result=0;for(let i=12;i+4<=data.length&&i<12+128*4;i+=4)result^=data.readUInt32LE(i);return result>>>0;}
function crypt(data:Buffer,key:string) {
  const words=schedule(key),length=Math.floor((data.length-12)/4);let index=0;
  for(let i=0;i<length;i=i<511?i+1:i===511?512:i+64) {
    const offset=12+i*4;data.writeUInt32LE((data.readUInt32LE(offset)^words[index++%1024])>>>0,offset);
  }
}
export function wrapCcz(input:Buffer,level=6,key?:string):Buffer {
  if(input.length<1||input.length>MAX_BYTES||!Number.isInteger(level)||level<0||level>9)throw Error('CCZ 长度或压缩等级无效');
  const header=Buffer.alloc(16);header.write(key?'CCZp':'CCZ!');header.writeUInt16BE(key?0:2,6);header.writeUInt32BE(input.length,12);
  const result=Buffer.concat([header,deflateSync(input,{level})]);
  if(key){result.writeUInt32BE(checksum(result),8);crypt(result,key);}
  return result;
}
export function unwrapCcz(input:Buffer,key?:string):Buffer {
  if(input.length<17||input.length>MAX_BYTES)throw Error('CCZ 文件损坏或长度超限');
  const signature=input.subarray(0,4).toString(),encrypted=signature==='CCZp';
  if(!['CCZ!','CCZp'].includes(signature)||input.readUInt16BE(4)!==0||input.readUInt16BE(6)>(encrypted?0:2))throw Error('CCZ 格式或版本不支持');
  const data=Buffer.from(input);
  if(encrypted) {
    if(!key)throw Error('此文件需要输入加密密钥');
    crypt(data,key);if(checksum(data)!==data.readUInt32BE(8))throw Error('密钥不匹配或文件损坏');
  }
  const length=data.readUInt32BE(12);
  if(length<1||length>MAX_BYTES)throw Error(encrypted?'密钥不匹配或文件损坏':'CCZ 解压长度超限');
  try {
    const output=inflateSync(data.subarray(16),{maxOutputLength:length});
    if(output.length!==length)throw Error('length');return output;
  } catch {throw Error(encrypted?'密钥不匹配或文件损坏':'CCZ 文件损坏或解压长度不匹配');}
}
