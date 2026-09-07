// GPT Image 2 Images API constraints, verified against official documentation:
// https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options
export const isFlexibleGptImage = name => /^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/.test(String(name || 'gpt-image-2').toLowerCase());

// Exact aspect ratios, not cropped or stretched results. 4K is a resolution tier:
// the 8,294,400-pixel ceiling means square/4:3 outputs cannot have a 3840px edge.
export const GPT_IMAGE_SIZES = Object.freeze({
  '1:1': ['1024x1024', '2048x2048', '2880x2880'],
  '16:9': ['1280x720', '2048x1152', '3840x2160'],
  '21:9': ['1568x672', '2016x864', '3696x1584'],
  '9:16': ['720x1280', '1152x2048', '2160x3840'],
  '4:3': ['1152x864', '2048x1536', '3264x2448'],
  '3:4': ['864x1152', '1536x2048', '2448x3264'],
});

export function gptImageSize(ratio = 'Auto', resolution = '1K') {
  if (ratio === 'Auto') return 'auto';
  const sizes = GPT_IMAGE_SIZES[ratio];
  const tier = ['1K', '2K', '4K'].indexOf(String(resolution).toUpperCase());
  if (!sizes || tier < 0) throw new Error('Unsupported GPT Image 2 output specification.');
  return sizes[tier];
}
