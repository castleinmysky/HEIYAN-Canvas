export const localConnectorUrl: string;
export function createLocalComfyApi(options: { nativeFetch: typeof fetch; baseApi: (request: Request) => Promise<Response>; origin: string }): (request: Request) => Promise<Response>;
