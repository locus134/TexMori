import { it,expect } from 'vitest';import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { JobQueue,WorkScheduler } from '../src/queue';import { validateRequest,type PlannedOutput } from '../../core/src/index';
it('continues after a failed file and retries only failed jobs',async()=>{
  const dir=await mkdtemp(path.join(await import('node:fs/promises').then(m=>m.realpath(os.tmpdir())),'cptool-queue-'));
  try{
    let fail=true;const calls:string[]=[];const source=path.join(dir,'encoded');await writeFile(source,'result');
    const plans=['a','b'].map(id=>({asset:{id,name:id},target:path.join(dir,id),request:validateRequest({operation:'decode',container:'png',output:{mode:'source',conflict:'overwrite'}})} as PlannedOutput));
    const queue=new JobQueue(async p=>{calls.push(p.asset.id);if(p.asset.id==='a'&&fail)throw Error('bad input');return source;},new WorkScheduler());
    await queue.start(plans);expect(queue.jobs.map(j=>j.state)).toEqual(['failed','succeeded']);
    fail=false;await queue.retryFailed();expect(calls).toEqual(['a','b','a']);expect(queue.jobs.map(j=>j.state)).toEqual(['succeeded','succeeded']);expect((await readFile(plans[0].target)).toString()).toBe('result');
  }finally{await rm(dir,{recursive:true,force:true});}
});
it('serializes encoder work and cancels pending tasks without starting them',async()=>{
  const scheduler=new WorkScheduler(),controller=new AbortController();const order:string[]=[];let release!:()=>void;
  const first=scheduler.run(async()=>{order.push('first');await new Promise<void>(r=>release=r);},new AbortController().signal);
  const second=scheduler.run(async()=>{order.push('second');},controller.signal);controller.abort();release();
  await first;await expect(second).rejects.toThrow();expect(order).toEqual(['first']);
});
