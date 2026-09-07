type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
export function registerTrialTools(readCanvas: () => object, saveCanvas: () => Promise<boolean>) {
  const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => unknown } }).modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const validate = (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); };
  for (const tool of [
    { name: 'read_heiyan_canvas', description: 'Read the current visible HEIYAN canvas, including unsaved node and connection data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (input: unknown) => { validate(input); return readCanvas(); } },
    { name: 'save_heiyan_canvas', description: 'Save the currently visible HEIYAN canvas to this browser using the same action as the Save control. Does not generate media or upload data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { validate(input); if (!await saveCanvas()) throw new Error('Canvas could not be saved. Resolve the visible save state before retrying.'); return { saved: true, storage: 'this-browser' }; } },
  ]) {
    try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* Optional browser capability. */ }
  }
  return () => lifecycle.abort();
}
