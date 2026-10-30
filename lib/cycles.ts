export function findLoops(adj: number[][], maxLen = 4): number[][] {
  const loops: number[][] = [], path: number[] = [], on = new Set<number>();
  const dfs = (s: number, u: number) => {
    for (const v of adj[u]) {
      if (v === s && path.length >= 2) loops.push([...path]);
      else if (v > s && !on.has(v) && path.length < maxLen) {
        path.push(v); on.add(v); dfs(s, v); path.pop(); on.delete(v);
      }
    }
  };
  for (let s = 0; s < adj.length; s++) { path.push(s); on.add(s); dfs(s, s); path.pop(); on.delete(s); }
  return loops;
}
