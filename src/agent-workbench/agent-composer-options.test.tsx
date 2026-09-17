import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentComposerOptions } from './AgentComposerOptions';
import { apiReasoningModel, type ApiProfile } from './agent-api';

describe('Agent composer API options', () => {
  it('keeps the connected custom API model and reasoning control visible', () => {
    const profile: ApiProfile = { provider: 'custom', baseUrl: 'https://relay.example/v1', apiKey: 'fixture', model: 'relay-model', protocol: 'responses', vision: false, effort: 'minimal', contextChars: 48000 };
    const html = renderToStaticMarkup(<AgentComposerOptions mode="ask" onMode={() => {}} models={[apiReasoningModel(profile)]} model={profile.model} effort={profile.effort} onModel={() => {}} onEffort={() => {}} active={false} />);
    expect(html).toContain('relay-model');
    expect(html).toContain('最低');
    expect(html).toContain('Responses reasoning.effort');
    expect(html).toContain('aria-label="默认"');
    expect(html).toContain('aria-label="超高"');
  });
});
