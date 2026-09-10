import { describe, it, expect } from 'vitest';
import { canvasAgentContext } from './agent-canvas';
import type { CanvasNode } from '../components/CanvasNodes';
import { sanitizeAgentContext, validateAgentTool } from '../../server/agent-contract.js';
import { emptyProject, mergeMessages, projectContext, searchProjectHistory } from './agent-memory';
import { apiPayload, apiEndpoint } from './agent-api';
import type { ApiProfile } from './agent-api';
const profile: ApiProfile = { provider: 'custom', baseUrl: 'https://gateway.vendor.com/v1', apiKey: 'never-send-to-memory', model: 'model', protocol: 'responses', effort: '', vision: true, contextChars: 48000 };
describe('Agent context and provider continuity', () => {
  it('finds selected and searched nodes beyond the old 200-node cap and pages full prompts', () => {
    const nodes = Array.from({ length: 260 }, (_, i) => ({ id: `n${i}`, type: 'text' as const, position: { x: 0, y: 0 }, selected: i === 259, data: { kind: 'text' as const, title: `node ${i}`, text: i === 259 ? 'A'.repeat(17000) + 'END' : '' } } as CanvasNode));
    const overview = canvasAgentContext(nodes, [], []);
    expect(overview.nodes[0].id).toBe('n259'); expect(overview.overview?.totalNodes).toBe(260);
    expect(overview.nodes[0].promptTruncated).toBe(true);
    const detail = sanitizeAgentContext(canvasAgentContext(nodes, [], [], [], { nodeIds: ['n259'], promptOffset: 16000 }));
    expect(detail.nodes[0].prompt).toBe('A'.repeat(1000) + 'END'); expect(detail.nodes[0].promptTruncated).toBe(false);
    expect(canvasAgentContext(nodes, [], [], [], { query: 'node 255' }).nodes[0].id).toBe('n255');
    expect(canvasAgentContext(nodes, [], [], [], { offset: 240 }).overview?.nextOffset).toBeNull();
  });
  it('retains original dialogue for retrieval while limiting loaded context', () => {
    const p = emptyProject(); p.requirements = '四头身，纯黑背景，不要武器';
    p.messages = Array.from({ length: 100 }, (_, i) => ({ id: String(i), role: 'user' as const, text: `第 ${i} 次要求` + '长'.repeat(800) }));
    expect(projectContext(p, 5000)).toContain(p.requirements);
    expect(projectContext(p, 5000).length).toBeLessThan(6000);
    expect(searchProjectHistory(p, '第 1 次要求')).toContain('第 1 次要求');
    expect(mergeMessages(p.messages, [{ ...p.messages[0], text: 'updated' }])).toHaveLength(100);
  });
  it('preserves calls and call results across both API formats without embedding keys', () => {
    const messages = [{ role: 'assistant' as const, content: '', toolCalls: [{ id: 'call1', name: 'heiyan_read_images', arguments: '{"nodeIds":["a"]}' }] }, { role: 'tool' as const, content: 'read a', callId: 'call1', images: ['data:image/png;base64,AA=='] }];
    const responses = apiPayload(profile, messages);
    expect(JSON.stringify(responses)).toContain('function_call_output'); expect(JSON.stringify(responses)).toContain('input_image');
    expect(JSON.stringify(responses)).not.toContain(profile.apiKey);
    const chat = apiPayload({ ...profile, protocol: 'chat' }, messages);
    expect(JSON.stringify(chat)).toContain('tool_call_id'); expect(JSON.stringify(chat)).toContain('image_url');
    expect(apiEndpoint({ ...profile, baseUrl: 'https://gateway.vendor.com/v1/chat/completions', protocol: 'responses' })).toBe('https://gateway.vendor.com/v1/responses');
  });
  it('rejects forged reading and checkpoint parameters and supports duplicate ids correctly', () => {
    expect(() => validateAgentTool('heiyan_read_images', { nodeIds: ['a'], url: 'https://attacker.com' })).toThrow();
    expect(() => validateAgentTool('heiyan_project_checkpoint', { summary: 'ok', apiKey: 'secret' })).toThrow();
    expect(validateAgentTool('heiyan_edit_canvas', { summary: 'copy', operations: [{ action: 'duplicate', nodeIds: ['a'] }] })).toBeTruthy();
  });
});
