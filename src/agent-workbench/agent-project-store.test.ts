import { describe,it,expect } from 'vitest';
import 'fake-indexeddb/auto';
import { localAgentProject } from './agent-project-store';
import { emptyProject } from './agent-memory';
describe('accountless Agent project memory',()=>{
  it('persists original messages and refuses concurrent claims without cloud accounts',async()=>{
    const key=crypto.randomUUID(),p=emptyProject();p.messages=[{id:'m',role:'user',text:'保留原始要求'}];
    expect((await localAgentProject(key)).document).toBeNull();
    const results=await Promise.allSettled([localAgentProject(key,p),localAgentProject(key,p)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const saved=await localAgentProject(key);expect(saved.document?.messages[0].text).toBe('保留原始要求');
    await expect(localAgentProject(key,p,null)).rejects.toThrow('另一页面');
    await localAgentProject(key,{...p,goal:'下一步'},saved.etag);
    expect((await localAgentProject(key)).document?.goal).toBe('下一步');
    expect((await localAgentProject(key+'other')).document).toBeNull();
  });
  it('excludes connection secrets and raw images from stored metadata',async()=>{
    const key=crypto.randomUUID();await localAgentProject(key,{...emptyProject(),apiKey:'NEVER_STORE',token:'NEVER_STORE',images:['data:secret']} as ReturnType<typeof emptyProject>);
    expect(JSON.stringify(await localAgentProject(key))).not.toContain('NEVER_STORE');
    expect(JSON.stringify(await localAgentProject(key))).not.toContain('data:secret');
  });
});
