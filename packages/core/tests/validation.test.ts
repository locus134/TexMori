import { describe, it, expect } from "vitest";
import { capabilities, validateRequest, targetDimensions } from "../src/index";
const base = {
  operation: "encode",
  codec: "etc2_rgba",
  container: "pkm",
  options: {},
  output: { mode: "source", conflict: "skip" },
};
describe("conversion boundary", () => {
  it("offers all 16 real modes and prevents PKM mipmaps", () => {
    expect(capabilities).toHaveLength(16);
    expect(() =>
      validateRequest({ ...base, options: { mipmaps: true } }),
    ).toThrow();
  });
  it("rejects hidden or fabricated options rather than forwarding them", () => {
    expect(() =>
      validateRequest({ ...base, options: { quality: "PVRTCBEST" } }),
    ).toThrow();
    expect(() =>
      validateRequest({ ...base, options: { command: "rm" } }),
    ).toThrow();
    expect(() => validateRequest({ ...base, operation: "rewrap" })).toThrow();
  });
  it("keeps valid options and checks the target container", () => {
    expect(validateRequest(base).codec).toBe("etc2_rgba");
    expect(() => validateRequest({ ...base, container: "dds" })).toThrow();
  });
  it("does not stretch images silently and applies codec-specific constraints", () => {
    expect(() => targetDimensions(13, 9, "etc1", "keep")).toThrow();
    expect(targetDimensions(13, 9, "etc1", "pad")).toEqual({
      width: 16,
      height: 12,
    });
    expect(targetDimensions(20, 12, "pvrtc1_rgba_4", "pad")).toEqual({
      width: 32,
      height: 16,
    });
    expect(targetDimensions(20, 12, "pvrtc2_4", "keep")).toEqual({
      width: 20,
      height: 12,
    });
    expect(() => targetDimensions(20, 12, "pvrtc2_2", "keep")).toThrow();
  });
});
