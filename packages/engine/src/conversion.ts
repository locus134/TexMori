import { mkdir,readFile,writeFile,stat } from 'node:fs/promises';
import path from 'node:path';import sharp from 'sharp';
import { capability,targetDimensions,validateRequest,type Asset,type ConversionRequest } from '../../core/src/index';
import { inspectTexture,pkmToPvr,writePkm,wrapCcz,unwrapCcz } from '../../containers/src/index';
import { runProcess } from './process-runner';
export interface EnginePaths {etcpak:string;pvrtc:string}
export interface ConversionResult {path:string;originalPath?:string;previewPath?:string;width:number;height:number;encodedWidth:number;encodedHeight:number;encodedBytes:number;finalBytes:number;payloadBytes:number}
const pvrFormats:Record<string,string>={pvrtc1_rgb_2:'PVRTCI_2BPP_RGB',pvrtc1_rgba_2:'PVRTCI_2BPP_RGBA',pvrtc1_rgb_4:'PVRTCI_4BPP_RGB',pvrtc1_rgba_4:'PVRTCI_4BPP_RGBA',pvrtc2_2:'PVRTCII_2BPP',pvrtc2_4:'PVRTCII_4BPP'};
export class ConversionService {
  constructor(private engines:EnginePaths){}
  private async decode(bytes:Buffer,directory:string,signal:AbortSignal):Promise<string> {
    const info=inspectTexture(bytes),input=path.join(directory,'decode-input.'+(info.container==='dds'?'dds':'pvr')),output=path.join(directory,'decoded.png');
    await writeFile(input,info.container==='pkm'?pkmToPvr(bytes):bytes);
    if(capability(info.codec).engine==='pvrtc')await runProcess(this.engines.pvrtc,['-i',input,'-noout','-d',output,'-f','r8g8b8a8'],signal);
    else await runProcess(this.engines.etcpak,['-v',input,output],signal);
    if(info.width!==info.encodedWidth||info.height!==info.encodedHeight) {
      const cropped=await sharp(output).extract({left:0,top:0,width:info.width,height:info.height}).png().toBuffer();await writeFile(output,cropped);
    }
    return output;
  }
  async run(asset:Asset,raw:ConversionRequest,directory:string,signal:AbortSignal,keys:{input?:string;output?:string}={},preview=false):Promise<ConversionResult> {
    const request=validateRequest(raw);signal.throwIfAborted();await mkdir(directory,{recursive:true,mode:0o700});
    let bytes=await readFile(asset.path);signal.throwIfAborted();
    if(bytes.length>256*1024*1024)throw Error('输入文件超过 256 MiB');
    if(['CCZ!','CCZp'].includes(bytes.subarray(0,4).toString()))bytes=unwrapCcz(bytes,keys.input);
    if(request.operation==='rewrap') {
      const info=inspectTexture(bytes);if(info.container!=='pvr')throw Error('只换容器需要 PVR 输入');
      const output=request.container==='ccz'?wrapCcz(bytes,request.cczLevel,request.encrypt?keys.output:undefined):bytes;
      const file=path.join(directory,'result.'+(request.container==='ccz'?'pvr.ccz':'pvr'));await writeFile(file,output);
      return {path:file,width:info.width,height:info.height,encodedWidth:info.encodedWidth,encodedHeight:info.encodedHeight,encodedBytes:bytes.length,finalBytes:output.length,payloadBytes:info.payloadBytes};
    }
    let originalPath:string;
    if(asset.container==='image') {
      originalPath=path.join(directory,'original.png');
      // Fixed policy: normalize profiled color images to sRGB; Linear means numeric
      // channel interpretation after normalization, including mip filtering.
      await sharp(bytes,{limitInputPixels:16384*16384}).rotate().toColourspace('srgb').ensureAlpha().png().toFile(originalPath);
    }else originalPath=await this.decode(bytes,directory,signal);
    signal.throwIfAborted();
    const metadata=await sharp(originalPath).metadata(),ow=metadata.width!,oh=metadata.height!;
    if(request.operation==='decode') {
      return {path:originalPath,originalPath,previewPath:originalPath,width:ow,height:oh,encodedWidth:ow,encodedHeight:oh,encodedBytes:bytes.length,finalBytes:(await stat(originalPath)).size,payloadBytes:inspectTexture(bytes).payloadBytes};
    }
    const c=capability(request.codec!),dimensions=targetDimensions(ow,oh,c.id,request.sizeMode);
    let image=sharp(originalPath);
    if(dimensions.width!==ow||dimensions.height!==oh) {
      if(request.sizeMode==='pad')image=image.extend({top:0,left:0,right:dimensions.width-ow,bottom:dimensions.height-oh,extendWith:'copy'});
      else image=image.resize(dimensions.width,dimensions.height,{fit:'fill',kernel:'lanczos3'});
    }
    const work=path.join(directory,'work.png');await image.png().toFile(work);
    const native=path.join(directory,'encoded.'+(request.container==='dds'?'dds':'pvr'));
    if(c.engine==='etcpak') {
      const args=['-c',c.id,'-h',request.container==='dds'?'dds':'pvr'];
      if(request.options.dither)args.push('-d');if(request.options.mipmaps)args.push('-m');
      if(request.options.heuristics===false)args.push('--disable-heuristics');if(request.colorSpace==='linear')args.push('--linear');
      args.push(work,native);await runProcess(this.engines.etcpak,args,signal);
    }else {
      const args=['-i',work,'-o',native,'-ics',request.colorSpace==='srgb'?'sRGB':'lRGB','-f',`${pvrFormats[c.id]},UBN,${request.colorSpace==='srgb'?'sRGB':'lRGB'}`,'-q',request.options.quality??'PVRTCNORMAL'];
      if(request.options.mipmaps)args.push('-m');if(request.options.mipFilter)args.push('-mfilter',request.options.mipFilter);if(request.options.premultiply)args.push('-p');
      await runProcess(this.engines.pvrtc,args,signal);
    }
    signal.throwIfAborted();const nativeBytes=await readFile(native),info=inspectTexture(nativeBytes);
    let final=nativeBytes;
    if(request.container==='pkm') {
      const logical=request.sizeMode==='pad'?{width:ow,height:oh}:dimensions;
      final=writePkm(c.id,logical.width,logical.height,dimensions.width,dimensions.height,nativeBytes.subarray(info.dataOffset));
    }else if(request.container==='ccz')final=wrapCcz(nativeBytes,request.cczLevel,request.encrypt?keys.output:undefined);
    const file=path.join(directory,'result.'+(request.container==='ccz'?'pvr.ccz':request.container));await writeFile(file,final);
    let previewPath:string|undefined;
    if(preview){const previewDirectory=path.join(directory,'preview');await mkdir(previewDirectory,{mode:0o700});previewPath=await this.decode(request.container==='pkm'?final:nativeBytes,previewDirectory,signal);}
    const resultInfo=request.container==='pkm'?inspectTexture(final):info;
    return {path:file,originalPath,previewPath,width:resultInfo.width,height:resultInfo.height,encodedWidth:dimensions.width,encodedHeight:dimensions.height,encodedBytes:nativeBytes.length,finalBytes:final.length,payloadBytes:info.payloadBytes};
  }
}
