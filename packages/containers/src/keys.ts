import { randomBytes } from 'node:crypto';
export function normalizeKey(input:string):string {
  let value=input.trim();
  if(/^\s*0x/i.test(value)) {
    const parts=value.match(/0x[0-9a-f]{8}/gi);
    if(!parts||parts.length!==4||value.replace(/0x[0-9a-f]{8}/gi,'').replace(/[\s,;{}()]/g,''))throw Error('密钥必须是 32 位十六进制或四段 0x 数值');
    value=parts.map(p=>p.slice(2)).join('');
  }
  if(!/^[0-9a-f]{32}$/i.test(value)||value.match(/.{8}/g)!.some(p=>parseInt(p,16)===0))throw Error('加密密钥必须包含四个非零的 32 位十六进制分段');
  return value.toLowerCase();
}
export function generateKey():string { for(;;){const key=randomBytes(16).toString('hex');try{return normalizeKey(key);}catch{}} }
export function cocosKeyExample(key:string):string {return `ZipUtils::setPvrEncryptionKey(${normalizeKey(key).match(/.{8}/g)!.map(p=>'0x'+p).join(', ')});`;}
