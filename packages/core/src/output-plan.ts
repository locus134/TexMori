import path from 'node:path';
import { capability,targetDimensions } from './capabilities';
import { validateRequest } from './validation';
import type { Asset,ConversionRequest,PlannedOutput } from './types';
export function pathKey(file:string) {return path.resolve(file).normalize('NFC').toLocaleLowerCase('en-US');}
export function planOutputs(assets:Asset[],raw:ConversionRequest,directory?:string,existing:string[]=[]):PlannedOutput[] {
  const request=validateRequest(raw);if(request.output.mode==='directory'&&!directory)throw Error('请先选择输出目录');
  const inputPaths=new Map(assets.map(a=>[pathKey(a.path),a.id]));
  const reserved=new Set(existing.map(pathKey));
  const plans:PlannedOutput[]=[];
  for(const asset of assets) {
    const root=request.output.mode==='source'?path.dirname(asset.path):directory!;
    const relative=request.output.mode==='source'?path.basename(asset.path):asset.relativePath;
    if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw Error('输入相对路径无效');
    const suffix=request.container==='ccz'?'.pvr.ccz':'.'+request.container;
    const base=relative.replace(/(?:\.pvr\.ccz|\.[^.]+)$/i,'');
    let target=path.resolve(root,base+suffix),key=pathKey(target),counter=2;
    const originalTarget=target;
    if(request.output.conflict==='rename')while(reserved.has(key)||inputPaths.has(key)){target=path.resolve(root,base+` (${counter++})`+suffix);key=pathKey(target);}
    let width=asset.width,height=asset.height,error=asset.error;
    if(request.operation==='encode') {try{({width,height}=targetDimensions(width,height,request.codec!,request.sizeMode));}catch(e){error=(e as Error).message;}}
    if(request.operation==='rewrap'&&!['pvr','ccz'].includes(asset.container))error='只换容器需要 PVR 或 PVR.CCZ 输入';
    if(inputPaths.has(key)&&inputPaths.get(key)!==asset.id)error='输出会替换其他输入文件';
    const plan:PlannedOutput={asset,request:structuredClone(request),target,width,height,alphaLoss:request.operation==='encode'&&asset.alpha&&!capability(request.codec!).channels.includes('A'),error,exists:existing.some(f=>pathKey(f)===pathKey(originalTarget))};
    const previous=plans.find(p=>pathKey(p.target)===key);
    if(previous){previous.error=plan.error='多个输入映射到相同输出，请选择自动重命名或调整目录';}
    reserved.add(key);plans.push(plan);
  }
  return plans;
}
