import { it, expect } from "vitest";
import { capability, targetDimensions, validateRequest } from "../src/index";
import { levelBytes, makePvr, inspectTexture } from "../../containers/src/index";
it("handles ASTC rectangular blocks, partial blocks and tiny mip levels", () => {
  expect(capability("astc_5x4").containers).toEqual(expect.arrayContaining(["pvr", "ccz", "astc", "ktx", "ktx2"]));
  expect(levelBytes("astc_5x4", 13, 9)).toBe(144);
  expect(levelBytes("astc_12x12", 1, 1)).toBe(16);
  expect(targetDimensions(13, 9, "astc_5x4", "keep")).toEqual({width:13,height:9});
  expect(targetDimensions(13, 9, "astc_5x4", "pad")).toEqual({width:15,height:12});
  const pvr = makePvr("astc_5x4", 13, 9, Buffer.alloc(144), "srgb");
  expect(pvr.readUInt32LE(8)).toBe(28);
  expect(inspectTexture(pvr)).toMatchObject({codec:"astc_5x4",width:13,height:9,payloadBytes:144});
  expect(() => inspectTexture(pvr.subarray(0,-1))).toThrow(/负载/);
});
it("validates ASTC quality independently of PVRTC and rejects incompatible containers", () => {
  const base = {operation:"encode",codec:"astc_6x6",container:"pvr",options:{quality:"ASTCFAST",mipmaps:true},output:{mode:"source",conflict:"skip"}};
  expect(validateRequest(base).codec).toBe("astc_6x6");
  expect(() => validateRequest({...base,options:{quality:"PVRTCFAST"}})).toThrow(/质量/);
  expect(() => validateRequest({...base,container:"dds"})).toThrow(/容器/);
});
