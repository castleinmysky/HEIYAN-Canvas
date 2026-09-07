import { describe, expect, it } from 'vitest';
import type { CanvasNode } from './components/CanvasNodes';
import type { Edge } from '@xyflow/react';
import { buildSelectedClonePlan, planCollectionInputReplacement, collectGeneratorInputsFromGraph } from './App';
import { collectionInputSlots } from './workflow-collection';
const n=(id:string,kind:CanvasNode['data']['kind'],extra={})=>({id,type:kind,position:{x:0,y:0},width:320,height:200,data:{kind,title:id,...extra}} as CanvasNode);
const graph=()=>{const nodes=[n('old','image',{mediaUrl:'/old.png',mediaType:'image'}),n('new','image',{mediaUrl:'/new.png',mediaType:'image'}),n('a','videoGenerator',{videoInputMode:'reference',jobState:'succeeded'}),n('b','videoGenerator',{videoInputMode:'reference',jobState:'succeeded'}),n('outside','videoGenerator',{videoInputMode:'reference'}),n('group','collection',{memberIds:['a','b']})];const edges:Edge[]=[{id:'ea',source:'old',target:'a',targetHandle:'reference',data:{referenceToken:'图片1',referenceOrder:1}},{id:'eb',source:'old',target:'b',targetHandle:'reference',data:{referenceToken:'图片1',referenceOrder:1}},{id:'external',source:'old',target:'outside',targetHandle:'reference'}];return {nodes,edges};};
describe('input-preserving duplication and group replacement',()=>{
 it('duplicates selected graph with inbound edges, input roles and remapped timing, without jobs or clipboard changes',()=>{
 const {nodes,edges}=graph();nodes.find(x=>x.id==='a')!.data.h3GuideTimes={ea:2};nodes.find(x=>x.id==='a')!.data.jobId='original-job';
 const plan=buildSelectedClonePlan(nodes,edges,['group'],'with-inputs','qa');
 expect(plan.nodes).toHaveLength(3);expect(plan.edges).toHaveLength(2);
 const a=plan.nodes.find(x=>x.data.title.startsWith('a'))!;expect(a.data.jobId).toBeUndefined();expect(a.data.h3GuideTimes).toEqual({[plan.edges.find(x=>x.target===a.id)!.id]:2});
 expect(plan.edges.every(x=>x.source==='old')).toBe(true);expect(plan.nodes.find(x=>x.data.kind==='collection')!.data.memberIds).toContain(a.id);
 });
 it('replaces only the selected group, keeps source nodes and stable slots, and propagates staleness',()=>{
 const {nodes,edges}=graph(),[slot]=collectionInputSlots(nodes,edges,['a','b']);const before=JSON.stringify({nodes,edges});
 const p=planCollectionInputReplacement(nodes,edges,'group',slot.id,'new');
 expect(p.error).toBe('');expect(p.usageCount).toBe(2);expect(p.edges.map(x=>x.source)).toEqual(['new','new','old']);expect(p.nodes.find(x=>x.id==='old')).toBe(nodes[0]);
 expect(collectionInputSlots(p.nodes,p.edges,['a','b'])[0].id).toBe(slot.id);expect(collectGeneratorInputsFromGraph(p.nodes,p.edges,'a')[0].value).toBe('/new.png');expect(p.nodes.find(x=>x.id==='a')!.data.stale).toBe(true);expect(JSON.stringify({nodes,edges})).toBe(before);
 });
 it('uses the currently selected generated image, not an old pinned preview',()=>{
 const {nodes,edges}=graph();nodes[1]=n('new','imageGenerator',{latestMediaType:'image',latestOutputs:[{mediaUrl:'/first.png'},{mediaUrl:'/chosen.png'}],selectedOutput:1});
 edges[0].data={...edges[0].data,pinSourceMedia:true,sourceMediaUrl:'/old.png',sourceVersion:'/old.png'};
 const [slot]=collectionInputSlots(nodes,edges,['a','b']),p=planCollectionInputReplacement(nodes,edges,'group',slot.id,'new');
 expect(p.error).toBe('');expect(collectGeneratorInputsFromGraph(p.nodes,p.edges,'a')[0].value).toBe('/chosen.png');
 });
 it('rejects empty, wrong-type, busy, stale and cyclic replacements without partial writes',()=>{
 for(const state of ['empty','type','busy','stale','cycle']){const {nodes,edges}=graph();const [slot]=collectionInputSlots(nodes,edges,['a','b']);if(state==='empty')nodes[1].data.mediaUrl='';if(state==='type')nodes[1]=n('new','text',{text:'x'});if(state==='busy')nodes[2].data.jobState='running';if(state==='cycle')edges.push({id:'cycle',source:'a',target:'new'});const before=JSON.stringify({nodes,edges});const p=planCollectionInputReplacement(nodes,edges,'group',state==='stale'?'missing':slot.id,'new');expect(p.changed,state).toBe(false);expect(p.error,state).not.toBe('');expect(JSON.stringify({nodes,edges})).toBe(before);}
 });
 it('preserves legacy internal reference nodes and group membership while rewiring their consumers',()=>{
 const {nodes,edges}=graph();nodes.find(x=>x.id==='group')!.data.memberIds=['old','a','b'];const [slot]=collectionInputSlots(nodes,edges,['old','a','b']);const p=planCollectionInputReplacement(nodes,edges,'group',slot.id,'new');
 expect(p.error).toBe('');expect(p.nodes.find(x=>x.id==='group')!.data.memberIds).toEqual(['old','a','b']);expect(p.nodes[0]).toBe(nodes[0]);expect(p.edges.find(x=>x.id==='external')!.source).toBe('old');
 });
});
