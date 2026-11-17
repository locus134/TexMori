import { it,expect } from 'vitest';import { mkdtemp,writeFile,readFile,rm,mkdir,symlink,realpath } from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { publishFile } from '../src/publish';
it('skips existing targets and atomically replaces only after a complete temporary file',async()=>{
  const dir=await mkdtemp(path.join(await realpath(os.tmpdir()),'cptool-publish-'));
  try{
    const source=path.join(dir,'encoded'),target=path.join(dir,'output');await writeFile(source,'new');await writeFile(target,'old');
    expect(await publishFile(source,target,'skip',new AbortController().signal)).toBe(false);expect((await readFile(target)).toString()).toBe('old');
    await expect(publishFile(path.join(dir,'missing'),target,'overwrite',new AbortController().signal)).rejects.toThrow();expect((await readFile(target)).toString()).toBe('old');
    expect(await publishFile(source,target,'overwrite',new AbortController().signal)).toBe(true);expect((await readFile(target)).toString()).toBe('new');
    await expect(publishFile(source,target,'overwrite',AbortSignal.abort())).rejects.toThrow();
    await mkdir(path.join(dir,'other'));await symlink(path.join(dir,'other'),path.join(dir,'link'));
    await expect(publishFile(source,path.join(dir,'link','a'),'overwrite',new AbortController().signal)).rejects.toThrow(/符号链接/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
