import { it, expect } from "vitest";
import { validateRequest } from "../src/index";
const base={operation:"encode",codec:"bc3",container:"dds",options:{},output:{mode:"source",conflict:"skip"}};
it("defaults transparent RGB cleanup on with a zero alpha threshold",()=>{
 expect(validateRequest(base).options).toMatchObject({cleanTransparentRgb:true,alphaThreshold:0});
 expect(validateRequest({...base,options:{cleanTransparentRgb:false,alphaThreshold:255}}).options.cleanTransparentRgb).toBe(false);
 for(const value of [-1,256,0.5,"64",null]) expect(()=>validateRequest({...base,options:{alphaThreshold:value}})).toThrow();
 expect(validateRequest({...base,operation:"decode",codec:undefined,container:"png"}).options).toEqual({});
});
