import { it, expect } from "vitest";
import { capability, validateRequest } from "../src/index";
it("offers compatible containers and rejects formats the container cannot represent", () => {
 expect(capability("astc_6x6").containers).toEqual(expect.arrayContaining(["astc","pvr","ccz","ktx","ktx2"]));
 expect(capability("etc1").containers).toEqual(expect.arrayContaining(["pkm","pvr","ccz","ktx"]));
 expect(capability("etc1").containers).not.toContain("ktx2");
 expect(capability("bc7").containers).toEqual(expect.arrayContaining(["dds","pvr","ccz","ktx","ktx2"]));
 const base={operation:"encode",codec:"astc_6x6",container:"astc",options:{},output:{mode:"source",conflict:"skip"}};
 expect(validateRequest(base).container).toBe("astc");
 expect(()=>validateRequest({...base,options:{mipmaps:true}})).toThrow(/Mipmap/);
 expect(()=>validateRequest({...base,options:{premultiply:true}})).toThrow();
});
