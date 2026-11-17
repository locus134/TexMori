import { it, expect, describe } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readPkm, writePkm, pkmToPvr, inspectTexture, wrapCcz, unwrapCcz, normalizeKey } from '../src/index';

describe('PKM structural contract',()=>{
  const payload=Buffer.alloc(16,0x51);
  it('records logical and encoded dimensions independently and extracts only payload',()=>{
    const result=writePkm('etc1',5,3,8,4,payload);
    expect(result.subarray(0,16).toString('hex')).toBe('504b4d20313000000008000400050003');
    expect(readPkm(result)).toMatchObject({codec:'etc1',width:5,height:3,encodedWidth:8,encodedHeight:4});
    expect(result.subarray(16)).toEqual(payload);
    expect(inspectTexture(pkmToPvr(result))).toMatchObject({codec:'etc1',width:8,height:4});
  });
  it('rejects truncated payload, invalid type and dimensions',()=>{
    const valid=writePkm('etc1',5,3,8,4,payload);
    expect(()=>readPkm(valid.subarray(0,30))).toThrow();
    const wrong=Buffer.from(valid); wrong.writeUInt16BE(99,6);expect(()=>readPkm(wrong)).toThrow();
    const size=Buffer.from(valid);size.writeUInt16BE(9,12);expect(()=>readPkm(size)).toThrow();
  });
});
describe('CCZ and session keys',()=>{
  const key='123456789abcdef013579bdf2468ace0';
  it('accepts four key parts and rejects zero parts or malformed keys',()=>{
    expect(normalizeKey('0x12345678, 0x9abcdef0, 0x13579bdf, 0x2468ace0')).toBe(key);
    expect(()=>normalizeKey('000000009abcdef013579bdf2468ace0')).toThrow();
    expect(()=>normalizeKey('password')).toThrow();
  });
  it.each([52,700,3000,20000])('preserves all bytes across plain and encrypted wrapping (%i bytes)',size=>{
    const input=Buffer.alloc(size);for(let i=0;i<size;i++)input[i]=(i*31+i%17)%256;
    for(const encryption of [undefined,key])expect(unwrapCcz(wrapCcz(input,6,encryption),encryption)).toEqual(input);
  });
  it('isolates different keys and does not reveal them in errors',()=>{
    const bytes=wrapCcz(Buffer.from('example PVR payload'),6,key);
    expect(bytes.subarray(0,4).toString()).toBe('CCZp');
    expect(()=>unwrapCcz(bytes)).toThrow(/密钥/);
    expect(()=>unwrapCcz(bytes,'abcdef011234567889abcdef13579bdf')).toThrow(/密钥不匹配或文件损坏/);
    expect(unwrapCcz(wrapCcz(Buffer.from('next'),6,'abcdef011234567889abcdef13579bdf'),'abcdef011234567889abcdef13579bdf').toString()).toBe('next');
  });
  it('rejects bad versions, decompression bombs and incorrect declared lengths',()=>{
    const header=Buffer.alloc(16);header.write('CCZ!');header.writeUInt16BE(2,6);header.writeUInt32BE(1,12);
    expect(()=>unwrapCcz(Buffer.concat([header,deflateSync(Buffer.alloc(100))]))).toThrow();
    header.writeUInt32BE(0xffffffff,12);expect(()=>unwrapCcz(Buffer.concat([header,Buffer.alloc(5)]))).toThrow();
    const version=wrapCcz(Buffer.from('a'));version.writeUInt16BE(3,6);expect(()=>unwrapCcz(version)).toThrow();
    expect(()=>unwrapCcz(Buffer.alloc(8))).toThrow();
  });
});
