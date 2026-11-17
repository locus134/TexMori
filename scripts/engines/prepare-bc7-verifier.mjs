import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.join(root,'build/bc7-independent');
await mkdir(directory,{recursive:true});
const commit='b9438627eef73a1157e84201b6fa6eb2ffd6d9f0';
for(const name of ['bc7decomp.cpp','bc7decomp.h','LICENSE']) {
  const response=await fetch(`https://raw.githubusercontent.com/richgel999/bc7enc_rdo/${commit}/${name}`);
  if(!response.ok)throw Error(`bc7decomp download: ${response.status}`);
  await writeFile(path.join(directory,name),await response.text());
}
execFileSync('clang++',['-std=c++17','-O2','-I',directory,path.join(root,'scripts/engines/verify-bc7.cpp'),path.join(directory,'bc7decomp.cpp'),'-o',path.join(directory,'verify-bc7')],{stdio:'inherit'});
