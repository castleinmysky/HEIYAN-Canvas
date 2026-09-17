import { describe, expect, it } from 'vitest';
import { apiPayload, apiReasoningModel, validateApiProfile, type ApiProfile } from './agent-api';

const profile: ApiProfile = { provider: 'custom', baseUrl: 'https://relay.example/v1', apiKey: 'fixture', model: 'reasoning-model', protocol: 'responses', vision: false, effort: 'minimal', contextChars: 48000, contextTokens: 128000, outputTokens: 4096 };

describe('custom API reasoning controls', () => {
  it('uses each protocol-native reasoning field without silent fallback', () => {
    expect(apiPayload(profile, [], '', false)).toMatchObject({ reasoning: { effort: 'minimal' } });
    expect(apiPayload({ ...profile, protocol: 'chat' }, [], '', false)).toMatchObject({ reasoning_effort: 'minimal' });
    expect(apiPayload({ ...profile, effort: '' }, [], '', false)).not.toHaveProperty('reasoning');
    expect(apiPayload({ ...profile, protocol: 'chat', effort: '' }, [], '', false)).not.toHaveProperty('reasoning_effort');
  });

  it('exposes the complete compatibility range and rejects unknown values', () => {
    const values = apiReasoningModel(profile).efforts.map(item => item.value);
    expect(values).toEqual(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(() => validateApiProfile({ ...profile, effort: 'turbo' })).toThrow('思考程度不受支持');
  });
});
