export function resolveComposerDrag(input: { startHeight: number; deltaY: number; elapsed: number; minHeight: number; maxHeight: number }) {
  const collapsed = input.deltaY > 100 || (input.deltaY > 44 && input.deltaY / Math.max(1, input.elapsed) > .65);
  const max = Math.max(input.minHeight, input.maxHeight);
  return { collapsed, height: Math.round(Math.max(input.minHeight, Math.min(max, input.startHeight - input.deltaY))) };
}
