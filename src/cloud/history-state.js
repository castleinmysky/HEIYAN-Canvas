// Output visibility is browser-owned. A delayed provider poll cannot restore it.
export function preserveHistoryVisibility(previous, incoming) {
  if (!Array.isArray(incoming)) return incoming;
  const byUrl = new Map((previous || []).filter(output => output.mediaUrl).map(output => [output.mediaUrl, output]));
  return incoming.map(output => {
    const old = byUrl.get(output.mediaUrl);
    if (!old) return output;
    return { ...output, ...(old.historyHiddenAt ? { historyHiddenAt: old.historyHiddenAt } : {}), ...(old.mediaDeletedAt ? { mediaDeletedAt: old.mediaDeletedAt } : {}),
      ...(old.metadata?.previewDeletedAt ? { metadata: { ...output.metadata, previewDeletedAt: old.metadata.previewDeletedAt } } : {}) };
  });
}
