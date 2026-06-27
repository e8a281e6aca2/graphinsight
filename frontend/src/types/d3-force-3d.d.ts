declare module 'd3-force-3d' {
  export type ForceCollide<NodeDatum> = {
    (alpha: number): void;
    initialize?: (nodes: NodeDatum[]) => void;
    strength: (value: number) => ForceCollide<NodeDatum>;
    iterations: (value: number) => ForceCollide<NodeDatum>;
  };

  export function forceCollide<NodeDatum>(
    radius: number | ((node: NodeDatum) => number)
  ): ForceCollide<NodeDatum>;
}
