import { describe, expect, it } from 'vitest';
import { agentApprovalModeKey, mayAutoApproveAgentProposal, readAgentApprovalMode, saveAgentApprovalMode } from './approval-mode';

describe('Agent approval mode', () => {
  it('full mode approves only supported current-canvas tools', () => {
    for (const tool of ['heiyan_edit_canvas', 'heiyan_request_generation', 'heiyan_read_images', 'heiyan_project_checkpoint']) {
      expect(mayAutoApproveAgentProposal('full', {}, tool)).toBe(true);
      expect(mayAutoApproveAgentProposal('ask', {}, tool)).toBe(false);
      expect(mayAutoApproveAgentProposal('assist', {}, tool)).toBe(false);
    }
    expect(mayAutoApproveAgentProposal('full', {}, 'shell')).toBe(false);
    expect(mayAutoApproveAgentProposal('full', { operations: [{ action: 'update', id: 'image', prompt: 'replace' }] })).toBe(true);
  });
  it('never persists or restores full authority', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) };
    saveAgentApprovalMode(storage, 'full');
    expect(readAgentApprovalMode(storage)).toBe('ask');
    values.set(agentApprovalModeKey, 'full');
    expect(readAgentApprovalMode(storage)).toBe('ask');
  });
  it('defaults safely and persists the explicit assist choice', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    expect(readAgentApprovalMode(storage)).toBe('ask');
    saveAgentApprovalMode(storage, 'assist');
    expect(values.get(agentApprovalModeKey)).toBe('assist');
    expect(readAgentApprovalMode(storage)).toBe('assist');
  });

  it('only auto-approves reversible structure edits in assist mode', () => {
    const safe = { summary: '搭建流程', operations: [{ action: 'create' as const, id: 'new', kind: 'text', title: '脚本' }, { action: 'connect' as const, source: 'new', target: 'image' }] };
    expect(mayAutoApproveAgentProposal('ask', safe)).toBe(false);
    expect(mayAutoApproveAgentProposal('assist', safe)).toBe(true);
    expect(mayAutoApproveAgentProposal('assist', { summary: '覆盖提示词', operations: [{ action: 'update', id: 'image', prompt: 'new' }] })).toBe(false);
    expect(mayAutoApproveAgentProposal('assist', { summary: '无操作', operations: [] })).toBe(false);
  });
});
