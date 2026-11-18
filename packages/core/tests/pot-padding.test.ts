import { it, expect } from "vitest";
import { targetDimensions, validateRequest, capabilities } from "../src/index";
it("extends every codec to the next POT without shrinking, respecting minimum blocks", () => {
  for (const codec of capabilities) {
    expect(targetDimensions(300, 500, codec.id, "pad-pot")).toEqual({width:512,height:512});
    expect(targetDimensions(256, 128, codec.id, "pad-pot")).toEqual({width:256,height:128});
    const tiny=targetDimensions(1,1,codec.id,"pad-pot");
    expect(tiny.width).toBe(codec.id.startsWith("astc_") ? 1 : codec.id.startsWith("pvrtc1") ? codec.bpp===2?16:8 : codec.id==="pvrtc2_2"?8:4);
    expect(tiny.height).toBe(codec.id.startsWith("astc_") ? 1 : codec.id.startsWith("pvrtc1")?8:4);
  }
  expect(targetDimensions(16383,16384,"etc2_rgba","pad-pot")).toEqual({width:16384,height:16384});
});
it("accepts POT expansion for encoding while preserving the default", () => {
 const input={operation:"encode",codec:"etc2_rgba",container:"pkm",output:{mode:"source",conflict:"skip"}};
 expect(validateRequest({...input,sizeMode:"pad-pot"}).sizeMode).toBe("pad-pot");
 expect(validateRequest(input).sizeMode).toBe("keep");
});
