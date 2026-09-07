export type ImageModelEntry = { id: string; adapter: string; name: string; tier: string; state: string; description: string };
export const imageModelCatalog: readonly ImageModelEntry[];
export function imageModelEntry(adapter: string, id: string): ImageModelEntry | undefined;
export const additionalImageModels: { id: string; name: string; capability: 'image'; adapter: 'gemini-image'; config: { model: string } }[];
export const imageQualityOptions: readonly string[];
export function withAdditionalImageModels<T extends { id: string }>(records: T[]): Array<T | { id: string; name: string; capability: 'image'; adapter: 'gemini-image'; enabled: false; config: object }>;
export function normalizeImageQuality(value?: string): string;
