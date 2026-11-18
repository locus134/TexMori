import { it, expect } from "vitest";
import { makePvr, inspectTexture } from "../src/index";
import { writeBc7Ktx } from "../src/extended";
it("rejects invalid KTX2 level offsets, dimensions and unsupported supercompression",()=>{
 const data=writeBc7Ktx(makePvr("bc7",8,8,Buffer.alloc(64)),true);
 expect(inspectTexture(data)).toMatchObject({codec:"bc7",container:"ktx2",payloadBytes:64});
 for(const mutate of [
  (b:Buffer)=>b.writeBigUInt64LE(0n,80),
  (b:Buffer)=>b.writeBigUInt64LE(999999n,80),
  (b:Buffer)=>b.writeUInt32LE(20000,20),
  (b:Buffer)=>b.writeUInt32LE(2,44),
  (b:Buffer)=>b.writeUInt32LE(6,36),
 ]) {const corrupted=Buffer.from(data);mutate(corrupted);expect(()=>inspectTexture(corrupted)).toThrow();}
});
