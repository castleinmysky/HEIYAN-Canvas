import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRecords } from '../src/trial-storage.js';
import { createCloudHistoryStore } from '../src/cloud/history-store.js';
import { preserveHistoryVisibility } from '../src/cloud/history-state.js';
import { createLocalComfyApi } from '../src/local-comfy-api.js';
test('delayed remote output updates cannot revive dismissed or deleted media', () => {
  const old=[{mediaUrl:'/a',historyHiddenAt:'hidden',mediaDeletedAt:'deleted',metadata:{previewDeletedAt:'deleted'}}];
  const next=preserveHistoryVisibility(old,[{mediaUrl:'/a',metadata:{width:2048}},{mediaUrl:'/new'}]);
  assert.equal(next[0].historyHiddenAt,'hidden'); assert.equal(next[0].mediaDeletedAt,'deleted'); assert.equal(next[0].metadata.previewDeletedAt,'deleted'); assert.equal(next[1].historyHiddenAt,undefined);
});
test('history reads never contact the generation connector, even for a waiting job', async () => {
  let contacted=0;const job={id:'local_test',localBridge:true,status:'running',bridgeWaiting:true};
  const api=createLocalComfyApi({origin:'https://test.example',nativeFetch:async()=>{contacted++;throw Error('Should not contact');},baseApi:async()=>Response.json({jobs:[job]})});
  const response=await api(new Request('https://test.example/api/v1/jobs?taskId=t&historyOnly=1'));
  assert.equal(response.status,200); assert.equal(contacted,0); assert.equal((await response.json()).jobs[0].status,'running');
});
test('clear history is stable after reopening and cannot cross task or board', async () => {
  const taskId='history-'+crypto.randomUUID(),id=crypto.randomUUID();
  for(const [suffix,task,board]of [['a',taskId,'main'],['b',taskId,'board-b'],['c','other-'+taskId,'main']])await localRecords.write('cloud:job:'+id+suffix,{id:id+suffix,taskId:task,canvasId:board,status:'succeeded',outputs:[{mediaType:'image',mediaUrl:'/media/assets/'+id+'.png'}]});
  const store=createCloudHistoryStore({});
  const response=await store.handle(new Request('https://test.example/api/v1/generation-history',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId,canvasId:'main',clearAll:true})}));
  assert.equal(response.status,200);
  assert.ok((await localRecords.read('cloud:job:'+id+'a')).outputs[0].historyHiddenAt);
  assert.equal((await localRecords.read('cloud:job:'+id+'b')).outputs[0].historyHiddenAt,undefined);
  assert.equal((await localRecords.read('cloud:job:'+id+'c')).outputs[0].historyHiddenAt,undefined);
});
