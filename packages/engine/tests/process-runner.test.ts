import { it,expect } from 'vitest';import { runProcess } from '../src/process-runner';
it('passes paths as literal arguments without a shell',async()=>{
  const result=await runProcess(process.execPath,['-e','console.log(process.argv[1])','a b;$(touch nope)']);
  expect(result.stdout.trim()).toBe('a b;$(touch nope)');
});
it('handles nonzero exit, timeout and abort with bounded diagnostics',async()=>{
  await expect(runProcess(process.execPath,['-e','process.exit(3)'])).rejects.toThrow(/编码器/);
  await expect(runProcess(process.execPath,['-e','setTimeout(()=>{},10000)'],undefined,50)).rejects.toThrow(/超时/);
  const controller=new AbortController();const pending=runProcess(process.execPath,['-e','setTimeout(()=>{},10000)'],controller.signal);controller.abort();await expect(pending).rejects.toThrow(/取消/);
});
