import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectionFrameContainingMembers } from './workflow-collection';
import { zoomHistoryImage } from './components/HistoryImageViewer';
const file=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');
describe('canvas stability without opening a browser',()=>{
 it('does not feed stale collapsed DOM measurements back into expanded frame repair',()=>{
  const group={id:'g',position:{x:0,y:0},width:600,height:400,measured:{width:200,height:116},data:{kind:'collection',collapsed:false}};
  const child={id:'n',position:{x:42,y:64},width:516,height:294,data:{kind:'image'}};
  for(let i=0;i<200;i++)expect(collectionFrameContainingMembers(group,[child])).toBeNull();
 });
 it('ignores subpixel rounding instead of repeatedly growing the frame',()=>{
  const group={id:'g',position:{x:0,y:0},width:600,height:400,data:{kind:'collection'}};
  const child={id:'n',position:{x:41.8,y:63.8},width:516.5,height:294.5,data:{kind:'image'}};
  expect(collectionFrameContainingMembers(group,[child])).toBeNull();
 });
 it('does not recursively expand malformed self-containing or nested historical groups',()=>{
  const g={id:'g',position:{x:0,y:0},width:200,height:160,data:{kind:'collection'}};
  expect(collectionFrameContainingMembers(g,[g,{...g,id:'other'}])).toBeNull();
 });
 it('really grows around content and then converges with rounded measurements',()=>{
  const g={id:'g',position:{x:0,y:0},width:200,height:160,data:{kind:'collection'}};
  const n={id:'n',position:{x:60,y:80},width:300,height:200,data:{kind:'image'}};
  const frame=collectionFrameContainingMembers(g,[n])!;
  expect(frame.width).toBeGreaterThan(200);
  expect(collectionFrameContainingMembers({...g,...frame,measured:{width:frame.width-.5,height:frame.height-.5}},[n])).toBeNull();
 });
 it('zooms around the cursor, stays bounded and leaves reset at full fit',()=>{
  const p={x:130,y:70},before={x:20,y:-10,zoom:1};
  const after=zoomHistoryImage(before,p,-120);
  expect((p.x-after.x)/after.zoom).toBeCloseTo((p.x-before.x)/before.zoom);
  expect(after.zoom).toBeGreaterThan(1);
  expect(zoomHistoryImage({...before,zoom:12},p,-240).zoom).toBe(12);
 });
 it('does not invent timed loading stages or hold a ready canvas',()=>{
  const app=file('./App.tsx');
  const loader=app.slice(app.indexOf('export function CanvasBootLoader'),app.indexOf('function Studio()'));
  expect(loader).not.toMatch(/setTimeout|setInterval/);
  expect(app).not.toContain('setShowCanvasLoader(false), 460');
 });
 it('opens connection setup first and uses one frame size when toggling groups',()=>{
  expect(file('./agent-workbench/CanvasAgentDock.tsx')).toContain('useState(() => !agent.connection)');
  expect(file('./workflow-collections.tsx')).toContain('measured: { width, height }, style: { ...node.style, width, height }');
 });
});
