import { it,expect } from 'vitest';import { mkdtemp,readFile,rm } from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import { AssetService } from '../../packages/engine/src/assets';
import { ConversionService } from '../../packages/engine/src/conversion';
import { validateRequest,capabilities } from '../../packages/core/src/index';
import { inspectTexture,unwrapCcz } from '../../packages/containers/src/index';
import sharp from 'sharp';
const root=process.cwd();
it('encodes and decodes every real format, with valid ETC PKM and BC DDS',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cptool-matrix-'));const assets=new AssetService();
  try{
    const [asset]=await assets.import([path.join(root,'tests/fixtures/generated/rgba.png')],new AbortController().signal);
    const service=new ConversionService({etcpak:path.join(root,'build/etcpak/etcpak'),pvrtc:path.join(root,'build/engines/PVRTexToolCLI')});
    for(const codec of capabilities){
      const request=validateRequest({operation:'encode',codec:codec.id,container:codec.containers[0],sizeMode:'keep',options:codec.engine==='pvrtc'?{quality:'PVRTCFASTEST'}:{},output:{mode:'source',conflict:'skip'}});
      const output=await service.run(asset,request,path.join(dir,codec.id),new AbortController().signal,{},true);
      expect(inspectTexture(await readFile(output.path))).toMatchObject({codec:codec.id,width:32,height:32});
      expect(output.width).toBe(32);expect(output.height).toBe(32);expect(output.encodedBytes).toBeGreaterThan(0);
      expect(await sharp(output.previewPath).metadata()).toMatchObject({width:32,height:32});
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
it('preserves logical PKM dimensions after edge padding and rewraps without an encoder',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cptool-padding-'));const assets=new AssetService();
  try{
    const [asset]=await assets.import([path.join(root,'tests/fixtures/generated/odd.png')],new AbortController().signal);
    const service=new ConversionService({etcpak:path.join(root,'build/etcpak/etcpak'),pvrtc:path.join(root,'build/engines/PVRTexToolCLI')});
    const request=validateRequest({operation:'encode',codec:'etc1',container:'pkm',sizeMode:'pad',output:{mode:'source',conflict:'skip'}});
    const output=await service.run(asset,request,dir,new AbortController().signal);expect(inspectTexture(await readFile(output.path))).toMatchObject({width:13,height:9,encodedWidth:16,encodedHeight:12});
    const [pvrAsset]=await assets.import([path.join(root,'build/matrix/pvrtc1_rgba_4.pvr')],new AbortController().signal);
    const noEngine=new ConversionService({etcpak:'/does-not-exist',pvrtc:'/does-not-exist'});
    const wrapped=await noEngine.run(pvrAsset,validateRequest({operation:'rewrap',container:'ccz',output:{mode:'source',conflict:'skip'}}),path.join(dir,'wrap'),new AbortController().signal);
    expect(unwrapCcz(await readFile(wrapped.path))).toEqual(await readFile(pvrAsset.path));
  }finally{await rm(dir,{recursive:true,force:true});}
});
