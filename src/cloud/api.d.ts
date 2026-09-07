export function createCloudApi(options: { origin: string; nativeFetch: typeof fetch }): (request: Request) => Promise<Response>;
