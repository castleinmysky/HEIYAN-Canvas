export function isInteractionTrial(): boolean;
export function createTrialRequestBridge(options: { origin: string; nativeFetch: typeof fetch; localApi?: (request: Request) => Promise<Response> }): {
  fetch: typeof fetch;
  serialize<T>(value: T): T;
  dispose(): void;
};
