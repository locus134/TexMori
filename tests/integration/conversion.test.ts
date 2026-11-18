import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AssetService } from "../../packages/engine/src/assets";
import { ConversionService } from "../../packages/engine/src/conversion";
import { validateRequest, capabilities } from "../../packages/core/src/index";
import { inspectTexture, unwrapCcz } from "../../packages/containers/src/index";
import sharp from "sharp";
const root = process.cwd();
it("multiplies numeric RGB by Alpha only when enabled, preserving source pixels and Alpha", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-rgb-alpha-"));
  try {
    const file = path.join(dir, "source.png");
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 200, g: 80, b: 20, alpha: 0.5 },
      },
    })
      .png()
      .toFile(file);
    const assets = new AssetService(),
      [asset] = await assets.import([file], new AbortController().signal);
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    for (const [codec, container] of [
      ["etc1", "pkm"],
      ["bc3", "dds"],
      ["pvrtc1_rgba_4", "pvr"],
    ] as const) {
      for (const enabled of [false, true]) {
        const outputDir = path.join(dir, codec + "-" + enabled);
        const request = validateRequest({
          operation: "encode",
          codec,
          container,
          options: enabled ? { multiplyRgbByAlpha: true } : {},
          output: { mode: "source", conflict: "skip" },
        });
        const result = await service.run(
          asset,
          request,
          outputDir,
          new AbortController().signal,
          {},
          true,
        );
        const pixels = await sharp(path.join(outputDir, "work.png"))
          .ensureAlpha()
          .raw()
          .toBuffer();
        expect([...pixels.subarray(0, 4)]).toEqual(
          enabled ? [100, 40, 10, 128] : [200, 80, 20, 128],
        );
        const original = await sharp(result.originalPath)
          .ensureAlpha()
          .raw()
          .toBuffer();
        expect([...original.subarray(0, 4)]).toEqual([200, 80, 20, 128]);
        if (codec === "bc3" && enabled) {
          const decoded = await sharp(result.previewPath)
            .ensureAlpha()
            .raw()
            .toBuffer();
          expect(decoded[0]).toBeGreaterThan(85);
          expect(decoded[0]).toBeLessThan(115);
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("encodes and decodes every real format, with valid ETC PKM and BC DDS", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-matrix-"));
  const assets = new AssetService();
  try {
    const [asset] = await assets.import(
      [path.join(root, "tests/fixtures/generated/rgba.png")],
      new AbortController().signal,
    );
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    for (const codec of capabilities) {
      const request = validateRequest({
        operation: "encode",
        codec: codec.id,
        container: codec.containers[0],
        sizeMode: "keep",
        options: codec.id.startsWith("astc_") ? { quality: "ASTCVERYFAST" } : codec.engine === "pvrtc" ? { quality: "PVRTCFASTEST" } : {},
        output: { mode: "source", conflict: "skip" },
      });
      const output = await service.run(
        asset,
        request,
        path.join(dir, codec.id),
        new AbortController().signal,
        {},
        true,
      );
      expect(inspectTexture(await readFile(output.path))).toMatchObject({
        codec: codec.id,
        width: 32,
        height: 32,
      });
      expect(output.width).toBe(32);
      expect(output.height).toBe(32);
      expect(output.encodedBytes).toBeGreaterThan(0);
      expect(await sharp(output.previewPath).metadata()).toMatchObject({
        width: 32,
        height: 32,
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("preserves logical PKM dimensions after edge padding and rewraps without an encoder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-padding-"));
  const assets = new AssetService();
  try {
    const [asset] = await assets.import(
      [path.join(root, "tests/fixtures/generated/odd.png")],
      new AbortController().signal,
    );
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    const request = validateRequest({
      operation: "encode",
      codec: "etc1",
      container: "pkm",
      sizeMode: "pad",
      output: { mode: "source", conflict: "skip" },
    });
    const output = await service.run(
      asset,
      request,
      dir,
      new AbortController().signal,
    );
    expect(inspectTexture(await readFile(output.path))).toMatchObject({
      width: 13,
      height: 9,
      encodedWidth: 16,
      encodedHeight: 12,
    });
    const [pvrAsset] = await assets.import(
      [path.join(root, "build/matrix/pvrtc1_rgba_4.pvr")],
      new AbortController().signal,
    );
    const noEngine = new ConversionService({
      etcpak: "/does-not-exist",
      pvrtc: "/does-not-exist",
    });
    const wrapped = await noEngine.run(
      pvrAsset,
      validateRequest({
        operation: "rewrap",
        container: "ccz",
        output: { mode: "source", conflict: "skip" },
      }),
      path.join(dir, "wrap"),
      new AbortController().signal,
    );
    expect(unwrapCcz(await readFile(wrapped.path))).toEqual(
      await readFile(pvrAsset.path),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["srgb", "linear"] as const)(
  "converts premultiplied %s input into a straight-alpha PNG working image",
  async (colorSpace) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-alpha-"));
    try {
      const file = path.join(dir, "alpha.png");
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 200, g: 80, b: 20, alpha: 0.5 },
        },
      })
        .png()
        .toFile(file);
      const assets = new AssetService(),
        [asset] = await assets.import([file], new AbortController().signal);
      const service = new ConversionService({
        etcpak: path.join(root, "build/etcpak/etcpak"),
        pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
      });
      const values: number[][] = [];
      for (const premultiply of [false, true]) {
        const request = validateRequest({
          operation: "encode",
          codec: "pvrtc1_rgba_4",
          container: "pvr",
          colorSpace,
          options: { quality: "PVRTCFASTEST", premultiply },
          output: { mode: "source", conflict: "skip" },
        });
        const result = await service.run(
          asset,
          request,
          path.join(dir, String(premultiply)),
          new AbortController().signal,
          {},
          true,
        );
        const pixels = await sharp(result.previewPath)
          .ensureAlpha()
          .raw()
          .toBuffer();
        values.push([...pixels.subarray(0, 4)]);
      }
      expect(
        Math.abs(values[1][0] - values[0][0]),
        JSON.stringify(values),
      ).toBeLessThan(22);
      expect(values[1][3]).toBe(values[0][3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it("generates full mip chains and exercises every exposed PVRTC quality and mip filter", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-mips-"));
  try {
    const assets = new AssetService(),
      [asset] = await assets.import(
        [path.join(root, "tests/fixtures/generated/rgba.png")],
        new AbortController().signal,
      );
    const service = new ConversionService({
      etcpak: path.join(root, "build/etcpak/etcpak"),
      pvrtc: path.join(root, "build/engines/PVRTexToolCLI"),
    });
    const { qualities } = await import("../../packages/core/src/index");
    for (const quality of qualities) {
      const request = validateRequest({
        operation: "encode",
        codec: "pvrtc1_rgba_4",
        container: "pvr",
        options: { quality, mipmaps: true, mipFilter: "linear" },
        output: { mode: "source", conflict: "skip" },
      });
      const result = await service.run(
        asset,
        request,
        path.join(dir, quality),
        new AbortController().signal,
      );
      expect(inspectTexture(await readFile(result.path)).mipmaps).toBe(6);
    }
    for (const mipFilter of ["nearest", "cubic"]) {
      const request = validateRequest({
        operation: "encode",
        codec: "pvrtc2_4",
        container: "pvr",
        options: { quality: "PVRTCFASTEST", mipmaps: true, mipFilter },
        output: { mode: "source", conflict: "skip" },
      });
      const result = await service.run(
        asset,
        request,
        path.join(dir, mipFilter),
        new AbortController().signal,
      );
      expect(inspectTexture(await readFile(result.path)).mipmaps).toBe(6);
    }
    const result = await service.run(
      asset,
      validateRequest({
        operation: "encode",
        codec: "bc3",
        container: "dds",
        options: { mipmaps: true },
        output: { mode: "source", conflict: "skip" },
      }),
      path.join(dir, "bc3"),
      new AbortController().signal,
    );
    expect(inspectTexture(await readFile(result.path)).mipmaps).toBe(6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("expands NPOT images transparently without resampling and exports POT logical dimensions", async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),"texmori-pot-"));
 try {
  const file=path.join(dir,"source.png");
  await sharp({create:{width:13,height:9,channels:4,background:{r:200,g:80,b:20,alpha:1}}}).png().toFile(file);
  const source=await readFile(file);
  const [asset]=await new AssetService().import([file],new AbortController().signal);
  const service=new ConversionService({etcpak:path.join(root,"build/etcpak/etcpak"),pvrtc:path.join(root,"build/engines/PVRTexToolCLI")});
  for(const [codec,container] of [["etc2_rgba","pkm"],["bc3","dds"],["pvrtc1_rgba_4","pvr"]] as const){
   const outDir=path.join(dir,codec);
   const output=await service.run(asset,validateRequest({operation:"encode",codec,container,sizeMode:"pad-pot",padAnchor:"top-left",options:codec.startsWith("pvrtc")?{quality:"PVRTCFASTEST"}:{},output:{mode:"source",conflict:"skip"}}),outDir,new AbortController().signal,{},true);
   expect(inspectTexture(await readFile(output.path))).toMatchObject({width:16,height:16,encodedWidth:16,encodedHeight:16});
   const {data,info}=await sharp(path.join(outDir,"work.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   for(let y=0;y<16;y++)for(let x=0;x<16;x++)expect([...data.subarray((y*info.width+x)*4,(y*info.width+x+1)*4)]).toEqual(x<13&&y<9?[200,80,20,255]:[0,0,0,0]);
   expect(await sharp(output.previewPath).metadata()).toMatchObject({width:16,height:16});
  }
  expect(await readFile(file)).toEqual(source);
 } finally {await rm(dir,{recursive:true,force:true});}
});

it("places the original pixels at all nine POT canvas anchors, including odd remainders", async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"texmori-anchors-"));
 try {
  const file=path.join(dir,"source.png");await sharp({create:{width:13,height:9,channels:4,background:{r:180,g:90,b:30,alpha:1}}}).png().toFile(file);
  const [asset]=await new AssetService().import([file],new AbortController().signal);
  const service=new ConversionService({etcpak:path.join(root,"build/etcpak/etcpak"),pvrtc:path.join(root,"build/engines/PVRTexToolCLI")});
  for(const [anchor,left,top]of [["top-left",0,0],["top",1,0],["top-right",3,0],["left",0,3],["center",1,3],["right",3,3],["bottom-left",0,7],["bottom",1,7],["bottom-right",3,7],[undefined,1,3]] as const){
   const outDir=path.join(dir,anchor??"default");
   const result=await service.run(asset,validateRequest({operation:"encode",codec:"etc2_rgba",container:"pkm",sizeMode:"pad-pot",padAnchor:anchor,output:{mode:"source",conflict:"skip"}}),outDir,new AbortController().signal);
   expect(result.originalOffset).toEqual({left,top});
   const {data,info}=await sharp(path.join(outDir,"work.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   for(let y=0;y<16;y++)for(let x=0;x<16;x++)expect([...data.subarray((y*info.width+x)*4,(y*info.width+x+1)*4)],anchor??"default").toEqual(x>=left&&x<left+13&&y>=top&&y<top+9?[180,90,30,255]:[0,0,0,0]);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

it("round-trips odd-sized ASTC mipmaps through CCZ and PNG while preserving RGBA", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texmori-astc-"));
  const signal = new AbortController().signal;
  try {
    const file = path.join(dir, "source.png");
    await sharp({create:{width:13,height:9,channels:4,background:{r:180,g:60,b:20,alpha:0.5}}}).png().toFile(file);
    const assets = new AssetService();
    const [asset] = await assets.import([file], signal);
    const service = new ConversionService({etcpak:path.join(root,"build/etcpak/etcpak"),pvrtc:path.join(root,"build/engines/PVRTexToolCLI")});
    const output = await service.run(asset, validateRequest({operation:"encode",codec:"astc_5x4",container:"ccz",sizeMode:"keep",options:{quality:"ASTCFAST",mipmaps:true,mipFilter:"linear"},output:{mode:"source",conflict:"skip"}}), path.join(dir,"encode"), signal, {}, true);
    const pvr = unwrapCcz(await readFile(output.path));
    expect(inspectTexture(pvr)).toMatchObject({codec:"astc_5x4",width:13,height:9,mipmaps:4,payloadBytes:208,colorSpace:"srgb"});
    const [encoded] = await assets.import([output.path], signal);
    expect(encoded.codec).toBe("astc_5x4");
    const decoded = await service.run(encoded, validateRequest({operation:"decode",container:"png",options:{},output:{mode:"source",conflict:"skip"}}),path.join(dir,"decode"),signal,{});
    const {data,info} = await sharp(decoded.path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect([info.width,info.height]).toEqual([13,9]);
    expect(data[0]).toBeGreaterThan(165);
    expect(data[0]).toBeLessThan(195);
    expect(data[3]).toBeGreaterThan(115);
    expect(data[3]).toBeLessThan(140);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

it("exports every advertised codec/container pair and imports and decodes the actual file", async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),"texmori-containers-"));
 const signal=new AbortController().signal;
 try {
  const assets=new AssetService();
  const [asset]=await assets.import([path.join(root,"tests/fixtures/generated/rgba.png")],signal);
  const service=new ConversionService({etcpak:path.join(root,"build/etcpak/etcpak"),pvrtc:path.join(root,"build/engines/PVRTexToolCLI")});
  for(const c of capabilities) for(const container of c.containers) {
   const tag=c.id+"-"+container;
   try {
   const encoded=await service.run(asset,validateRequest({operation:"encode",codec:c.id,container,options:c.engine==="pvrtc"?{quality:c.id.startsWith("astc_")?"ASTCVERYFAST":"PVRTCFASTEST"}:{},output:{mode:"source",conflict:"skip"}}),path.join(dir,tag),signal,{});
   const [imported]=await assets.import([encoded.path],signal);
   expect(imported.error,tag).toBeUndefined();
   expect(imported.container,tag).toBe(container);
   expect([imported.width,imported.height],tag).toEqual([32,32]);
   const decoded=await service.run(imported,validateRequest({operation:"decode",container:"png",options:{},output:{mode:"source",conflict:"skip"}}),path.join(dir,tag+"-decoded"),signal,{});
   const m=await sharp(decoded.path).metadata();
   expect([m.width,m.height],tag).toEqual([32,32]);
   } catch(e) { throw new Error(tag+": "+(e as Error).message); }
  }
 } finally {await rm(dir,{recursive:true,force:true});}
},60000);

it("preserves every mip payload when wrapping KTX and KTX2, including BC7", async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"texmori-ktx-mips-")),signal=new AbortController().signal;
 try {
 const assets=new AssetService(),[asset]=await assets.import([path.join(root,"tests/fixtures/generated/rgba.png")],signal);
 const service=new ConversionService({etcpak:path.join(root,"build/etcpak/etcpak"),pvrtc:path.join(root,"build/engines/PVRTexToolCLI")});
 for(const codec of ["bc7","astc_5x4","etc2_rgba"] as const) for(const container of ["ktx","ktx2"] as const) {
  const result=await service.run(asset,validateRequest({operation:"encode",codec,container,options:{mipmaps:true,...(codec.startsWith("astc")?{quality:"ASTCVERYFAST"}:{})},output:{mode:"source",conflict:"skip"}}),path.join(dir,codec+container),signal,{});
  const data=await readFile(result.path),{extendedToPvr}=await import("../../packages/containers/src/extended");
  const info=inspectTexture(data);expect(info).toMatchObject({codec,mipmaps:6});
  const pvr=extendedToPvr(data);
  const native=await readFile(path.join(dir,codec+container,"encoded.pvr"));
  expect(pvr.subarray(52)).toEqual(native.subarray(inspectTexture(native).dataOffset));
  expect(()=>inspectTexture(data.subarray(0,-1))).toThrow();
  const [input]=await assets.import([result.path],signal);
  const decoded=await service.run(input,validateRequest({operation:"decode",container:"png",options:{},output:{mode:"source",conflict:"skip"}}),path.join(dir,codec+container+"decoded"),signal,{});
  expect((await sharp(decoded.path).metadata()).width).toBe(32);
 }
 }finally{await rm(dir,{recursive:true,force:true});}
});
