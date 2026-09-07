export const H3_GENERATION_CONTRACT_VERSION = 2026081603;

export type H3GenerationOptions = {
  ratio: string;
  resolution: string;
  count: number;
  duration: number;
  audioEnabled: boolean;
  refImageSize: 'match' | 'max';
  referenceVideoAudio: boolean;
  h3EncodingPreset: 'quality' | 'balanced' | 'compact' | 'quality10';
  h3SamplingSteps: number;
  h3AccelerationMode: 'standard' | 'turbo' | 'reference8' | 'community8';
  h3BlockCache?: boolean;
  h3FaceRefine?: boolean;
  seed?: number;
};

type SubmittedInput = { port?: unknown; type?: unknown; value?: unknown; referenceToken?: unknown; duration?: unknown; guideFrame?: unknown };

function comparableInputs(value: unknown) {
  return (Array.isArray(value) ? value : []).map((input: SubmittedInput) => ({
    port: String(input?.port || ''),
    type: String(input?.type || ''),
    value: String(input?.value || ''),
    referenceToken: String(input?.referenceToken || ''),
    duration: input?.duration === undefined ? null : Number(input.duration),
    guideFrame: input?.guideFrame === undefined ? null : Number(input.guideFrame),
  }));
}

export function assertH3GenerationEcho(requested: {
  modelId: string;
  capability: string;
  prompt: string;
  inputs: SubmittedInput[];
  options: H3GenerationOptions;
}, job: unknown): void {
  const echoed = job && typeof job === 'object' ? job as Record<string, unknown> : {};
  const echoedOptions = echoed.options && typeof echoed.options === 'object' ? echoed.options as Record<string, unknown> : {};
  const mismatches: string[] = [];
  const compare = (label: string, expected: unknown, actual: unknown) => {
    if (expected !== actual) mismatches.push(`${label}（请求 ${String(expected)}，服务端 ${String(actual)}）`);
  };

  compare('模型', requested.modelId, echoed.modelId);
  compare('能力', requested.capability, echoed.capability);
  compare('提示词', requested.prompt, echoed.prompt);
  if (JSON.stringify(comparableInputs(requested.inputs)) !== JSON.stringify(comparableInputs(echoed.inputs))) mismatches.push('输入素材、顺序或引用标签');
  (['ratio', 'resolution', 'count', 'duration', 'audioEnabled', 'refImageSize', 'referenceVideoAudio', 'h3EncodingPreset', 'h3SamplingSteps', 'h3AccelerationMode', 'h3BlockCache', 'h3FaceRefine'] as const)
    .forEach((key) => compare(key, requested.options[key], echoedOptions[key]));
  if (requested.options.seed !== undefined) compare('seed', requested.options.seed, echoedOptions.seed);

  if (mismatches.length) throw new Error(`H3 参数链路校验失败：${mismatches.join('；')}。任务已取消，请重启 AI 创作台后重试。`);
}
