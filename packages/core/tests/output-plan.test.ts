import { it,expect } from 'vitest';import path from 'node:path';
import { planOutputs } from '../src/output-plan';
import { validateRequest,type Asset } from '../src/index';
const asset=(id:string,name:string,root='/in'):Asset=>({id,name,path:path.join(root,name),root,relativePath:name,width:32,height:32,encodedWidth:32,encodedHeight:32,container:'image',alpha:true,size:200,fingerprint:id,encrypted:false});
const request=validateRequest({operation:'encode',codec:'etc1',container:'pkm',output:{mode:'directory',conflict:'skip'}});
it('detects case-equivalent collisions across import roots and preserves compound extensions',()=>{
  const plans=planOutputs([asset('1','猫.A.png'),asset('2','猫.a.png','/other')],request,'/out');
  expect(plans.every(p=>p.error)).toBe(true);
  const p=planOutputs([asset('3','map.pvr.ccz')],request,'/out');expect(p[0].target).toBe('/out/map.pkm');
});
it('reserves auto-renamed targets and rejects traversal or replacement of another input',()=>{
  const renamed=planOutputs([asset('1','a.png'),asset('2','a.jpg','/other')],{...request,output:{mode:'directory',conflict:'rename'}},'/out');
  expect(new Set(renamed.map(p=>p.target)).size).toBe(2);
  expect(()=>planOutputs([asset('1','../escape.png')],request,'/out')).toThrow();
  const source={...request,output:{mode:'source' as const,conflict:'overwrite' as const}};
  const original=asset('2','a.pkm');original.container='pkm';
  const conflict=planOutputs([asset('1','a.png'),original],source);
  expect(conflict[0].error).toBeTruthy();
});
