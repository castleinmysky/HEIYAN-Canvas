import type { AgentProject } from './agent-memory';

// Self-hosted HEIYAN is accountless. Project memory belongs to this browser,
// not a shared server file or a ChatGPT/Sites identity.
export const agentProjectDatabase = 'heiyan-agent-projects-v1';
function cleanProject(value: AgentProject): AgentProject {
  if (!value || value.schema !== 1 || !Array.isArray(value.messages) || !Array.isArray(value.receipts)
    || !['requirements','goal','progress','summary'].every(k => typeof value[k as keyof AgentProject] === 'string' && String(value[k as keyof AgentProject]).length <= 24000)) throw Error('项目记录格式无效');
  const result: AgentProject = {
    schema:1, requirements:value.requirements, goal:value.goal, progress:value.progress, summary:value.summary, updatedAt:Date.now(),
    messages:value.messages.map(m=>{
      if(!m || typeof m.id!=='string' || !['user','assistant','notice'].includes(m.role) || typeof m.text!=='string' || m.text.length>100000) throw Error('会话消息格式无效');
      return {id:m.id,role:m.role,text:m.text,...(m.imageCount?{imageCount:m.imageCount}:{}),...(m.model?{model:String(m.model).slice(0,120)}:{})};
    }),
    receipts:value.receipts.map(r=>({id:String(r.id).slice(0,180),tool:String(r.tool).slice(0,100),status:['claimed','succeeded','failed','rejected'].includes(r.status)?r.status:'claimed',result:String(r.result||'').slice(0,24000),at:Number(r.at)||Date.now()})),
    usage:(value.usage||[]).slice(-500).filter(u=>u&&['input','output','cached'].every(k=>Number.isFinite(u[k as 'input'])&&u[k as 'input']>=0)).map(u=>({id:String(u.id),model:String(u.model),kind:String(u.kind),input:u.input,output:u.output,cached:Math.min(u.input,u.cached),source:u.source==='reported'?'reported':'estimated',...(Number.isFinite(u.usd)&&u.usd!>=0?{usd:u.usd}:{}),at:Number(u.at)||Date.now()})),
  };
  if(new Blob([JSON.stringify(result)]).size>8*1024*1024) throw Error('会话记录超过 8 MB，请导出后开始新任务');
  return result;
}
export async function localAgentProject(canvas: string, document?: AgentProject, etag: string | null = null): Promise<{document?:AgentProject|null;etag:string|null;updatedAt?:number}> {
  if(!canvas || canvas.length>500) throw Error('缺少画布标识');
  const clean=document?cleanProject(document):undefined;
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(agentProjectDatabase,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('projects');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects',clean?'readwrite':'readonly'),store=tx.objectStore('projects');
    let result:{document?:AgentProject|null;etag:string|null;updatedAt?:number},error:Error|undefined;
    tx.oncomplete=()=>{db.close();if(error)reject(error);else resolve(result);};
    tx.onabort=()=>{db.close();reject(tx.error||Error('浏览器未能保存会话，请保留当前页面'));};
    const request=store.get(canvas);
    request.onsuccess=()=>{
      const current=request.result as {document:AgentProject;etag:string}|undefined;
      if(!clean){result={document:current?.document||null,etag:current?.etag||null};return;}
      if((current?.etag||null)!==etag){error=Error('另一页面已更新此项目，请重新载入记录；操作尚未执行');return;}
      const nextTag=crypto.randomUUID().replaceAll('-','');
      store.put({document:clean,etag:nextTag},canvas);result={etag:nextTag,updatedAt:clean.updatedAt};
    };
  });
}
