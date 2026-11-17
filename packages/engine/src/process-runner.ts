import { spawn } from 'node:child_process';
export function runProcess(binary:string,args:string[],signal?:AbortSignal,timeout=120000):Promise<{stdout:string;stderr:string}> {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('任务已取消'));return;}
    const child=spawn(binary,args,{shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,killTimer:ReturnType<typeof setTimeout>|undefined;
    const stop=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);killTimer.unref();};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
    signal?.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',data=>{stdout=(stdout+data.toString()).slice(-32768);});
    child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-32768);});
    const cleanup=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal?.removeEventListener('abort',stop);};
    child.on('error',()=>{cleanup();reject(Error('编码器不可用，无法启动工作进程'));});
    child.on('close',(code)=>{cleanup();if(signal?.aborted)reject(Error('任务已取消'));else if(timedOut)reject(Error('编码器运行超时'));else if(code!==0)reject(Error(`编码器失败（退出码 ${code??'崩溃'}）`));else resolve({stdout,stderr});});
  });
}
