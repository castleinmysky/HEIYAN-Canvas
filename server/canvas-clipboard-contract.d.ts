export declare const canvasClipboardNodeKinds: ReadonlySet<string>;
export declare const canvasClipboardRuntimeKeys: ReadonlySet<string>;
export declare function stripCanvasClipboardRuntime<T extends Record<string, unknown>>(data: T): Partial<T>;
