/** Cache metadata-only work. Positions/selection never affect source media or reference tokens. */
export function createCanvasMetadataCache<N extends { id: string; data: unknown }, E extends { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }, R>(compute: (nodes: readonly N[], edges: readonly E[]) => R) {
  let previousNodes: readonly N[] | undefined;
  let previousEdges: readonly E[] | undefined;
  let result: R;
  return (nodes: readonly N[], edges: readonly E[]): R => {
    const sameNodes = previousNodes?.length === nodes.length && nodes.every((node, i) => node.id === previousNodes![i].id && node.data === previousNodes![i].data);
    const sameEdges = previousEdges?.length === edges.length && edges.every((edge, i) => {
      const old = previousEdges![i];
      return edge.id === old.id && edge.source === old.source && edge.target === old.target && edge.sourceHandle === old.sourceHandle && edge.targetHandle === old.targetHandle && edge.data === old.data;
    });
    if (!sameNodes || !sameEdges) {
      result = compute(nodes, edges);
      previousNodes = nodes; previousEdges = edges;
    }
    return result!;
  };
}

/** ReactFlow owns smooth viewport movement; surrounding React UI receives bounded updates. */
export function createViewportPublisher<T>(publish: (value: T) => void, delay = 40) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T;
  return {
    schedule(value: T) {
      pending = value;
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; publish(pending); }, delay);
    },
    flush(value: T) { this.cancel(); publish(value); },
    cancel() { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}
