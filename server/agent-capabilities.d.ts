export type CanvasCapability = { action: string; category: string; label: string; risk: 'read' | 'view' | 'edit' | 'generate' | 'user' | 'confirm'; note: string; parameters: Record<string, unknown> };
export const canvasCapabilities: readonly CanvasCapability[];
export const agentNodeSettings: Record<string, object>;
export function canvasCapability(action?: string): CanvasCapability | undefined;
export function validateCanvasAction(input: { action?: string; arguments?: string }): { capability: CanvasCapability; args: Record<string, any> };
export function discoverCanvasCapabilities(input?: { action?: string; category?: string }): unknown;
