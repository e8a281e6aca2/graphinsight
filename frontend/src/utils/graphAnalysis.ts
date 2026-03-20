/**
 * 图谱分析工具（Renderer 数据版本）
 * 提供节点重要性分析、中心性计算等功能
 */

import type { RendererEdge, RendererNode } from '../renderers/core/types';

export interface NodeImportance {
  id: string;
  label: string;
  pageRank: number;
  degreeCentrality: number;
  betweennessCentrality: number;
  closenessCentrality: number;
}

interface GraphDataLike {
  nodes: RendererNode[];
  edges: RendererEdge[];
}

interface NeighborLink {
  id: string;
  edgeId: string;
}

function buildDirectedAdjacency(edges: RendererEdge[]) {
  const outMap = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (!outMap.has(edge.source)) outMap.set(edge.source, []);
    if (!inMap.has(edge.target)) inMap.set(edge.target, []);
    outMap.get(edge.source)!.push(edge.target);
    inMap.get(edge.target)!.push(edge.source);
  });

  return { outMap, inMap };
}

function buildUndirectedAdjacency(edges: RendererEdge[]) {
  const adjacency = new Map<string, NeighborLink[]>();

  edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);

    adjacency.get(edge.source)!.push({ id: edge.target, edgeId: edge.id });
    adjacency.get(edge.target)!.push({ id: edge.source, edgeId: edge.id });
  });

  return adjacency;
}

/**
 * PageRank 算法
 */
export function calculatePageRank(
  data: GraphDataLike,
  dampingFactor: number = 0.85,
  maxIterations: number = 100,
  tolerance: number = 0.0001
): Map<string, number> {
  const nodes = data.nodes;
  const nodeCount = nodes.length;

  if (nodeCount === 0) {
    return new Map();
  }

  const { outMap, inMap } = buildDirectedAdjacency(data.edges);

  const pageRank = new Map<string, number>();
  const newPageRank = new Map<string, number>();

  nodes.forEach((node) => {
    pageRank.set(node.id, 1 / nodeCount);
  });

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let diff = 0;

    nodes.forEach((node) => {
      const nodeId = node.id;
      const incomers = inMap.get(nodeId) || [];

      let sum = 0;
      incomers.forEach((incomerId) => {
        const outDegree = (outMap.get(incomerId) || []).length;
        if (outDegree > 0) {
          sum += (pageRank.get(incomerId) || 0) / outDegree;
        }
      });

      const newValue = (1 - dampingFactor) / nodeCount + dampingFactor * sum;
      newPageRank.set(nodeId, newValue);
      diff += Math.abs(newValue - (pageRank.get(nodeId) || 0));
    });

    newPageRank.forEach((value, key) => {
      pageRank.set(key, value);
    });

    if (diff < tolerance) {
      break;
    }
  }

  return pageRank;
}

/**
 * 度中心性
 */
export function calculateDegreeCentrality(data: GraphDataLike): Map<string, number> {
  const centrality = new Map<string, number>();
  const nodes = data.nodes;
  const nodeCount = nodes.length;

  if (nodeCount <= 1) {
    nodes.forEach((node) => centrality.set(node.id, 0));
    return centrality;
  }

  const adjacency = buildUndirectedAdjacency(data.edges);

  nodes.forEach((node) => {
    const degree = adjacency.get(node.id)?.length || node.degree || 0;
    const normalizedDegree = degree / (nodeCount - 1);
    centrality.set(node.id, normalizedDegree);
  });

  return centrality;
}

/**
 * 介数中心性（Brandes，未加权）
 */
export function calculateBetweennessCentrality(data: GraphDataLike): Map<string, number> {
  const nodes = data.nodes.map((node) => node.id);
  const adjacency = buildUndirectedAdjacency(data.edges);
  const centrality = new Map<string, number>();

  nodes.forEach((id) => centrality.set(id, 0));

  nodes.forEach((sourceId) => {
    const stack: string[] = [];
    const predecessors = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const distance = new Map<string, number>();

    nodes.forEach((id) => {
      predecessors.set(id, []);
      sigma.set(id, 0);
      distance.set(id, -1);
    });

    sigma.set(sourceId, 1);
    distance.set(sourceId, 0);

    const queue: string[] = [sourceId];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const neighbors = adjacency.get(v) || [];
      neighbors.forEach((neighbor) => {
        const w = neighbor.id;
        if ((distance.get(w) ?? -1) < 0) {
          queue.push(w);
          distance.set(w, (distance.get(v) || 0) + 1);
        }
        if (distance.get(w) === (distance.get(v) || 0) + 1) {
          sigma.set(w, (sigma.get(w) || 0) + (sigma.get(v) || 0));
          predecessors.get(w)!.push(v);
        }
      });
    }

    const delta = new Map<string, number>();
    nodes.forEach((id) => delta.set(id, 0));

    while (stack.length > 0) {
      const w = stack.pop()!;
      const coeff = 1 / (sigma.get(w) || 1);
      predecessors.get(w)!.forEach((v) => {
        const value = (sigma.get(v) || 0) * coeff * (1 + (delta.get(w) || 0));
        delta.set(v, (delta.get(v) || 0) + value);
      });
      if (w !== sourceId) {
        centrality.set(w, (centrality.get(w) || 0) + (delta.get(w) || 0));
      }
    }
  });

  const nodeCount = nodes.length;
  if (nodeCount > 2) {
    const normFactor = (nodeCount - 1) * (nodeCount - 2) / 2;
    centrality.forEach((value, key) => {
      centrality.set(key, value / normFactor);
    });
  }

  return centrality;
}

/**
 * 接近中心性
 */
export function calculateClosenessCentrality(data: GraphDataLike): Map<string, number> {
  const nodes = data.nodes.map((node) => node.id);
  const adjacency = buildUndirectedAdjacency(data.edges);
  const centrality = new Map<string, number>();

  nodes.forEach((sourceId) => {
    const distance = new Map<string, number>();
    nodes.forEach((id) => distance.set(id, Infinity));
    distance.set(sourceId, 0);

    const queue: string[] = [sourceId];
    while (queue.length > 0) {
      const v = queue.shift()!;
      const neighbors = adjacency.get(v) || [];
      neighbors.forEach((neighbor) => {
        if (distance.get(neighbor.id) === Infinity) {
          distance.set(neighbor.id, (distance.get(v) || 0) + 1);
          queue.push(neighbor.id);
        }
      });
    }

    let totalDistance = 0;
    let reachableCount = 0;

    nodes.forEach((targetId) => {
      if (targetId === sourceId) return;
      const dist = distance.get(targetId) ?? Infinity;
      if (dist !== Infinity && dist > 0) {
        totalDistance += dist;
        reachableCount += 1;
      }
    });

    if (totalDistance > 0 && reachableCount > 0) {
      centrality.set(sourceId, reachableCount / totalDistance);
    } else {
      centrality.set(sourceId, 0);
    }
  });

  return centrality;
}

/**
 * 综合节点重要性分析
 */
export function analyzeNodeImportance(data: GraphDataLike): NodeImportance[] {
  const pageRankMap = calculatePageRank(data);
  const degreeMap = calculateDegreeCentrality(data);
  const betweennessMap = calculateBetweennessCentrality(data);
  const closenessMap = calculateClosenessCentrality(data);

  return data.nodes.map((node) => ({
    id: node.id,
    label: node.label || node.id,
    pageRank: pageRankMap.get(node.id) || 0,
    degreeCentrality: degreeMap.get(node.id) || 0,
    betweennessCentrality: betweennessMap.get(node.id) || 0,
    closenessCentrality: closenessMap.get(node.id) || 0,
  }));
}

/**
 * 根据重要性计算节点大小
 */
export function getNodeSizeOverrides(
  importance: NodeImportance[],
  importanceType: 'pageRank' | 'degree' | 'betweenness' | 'closeness',
  minSize: number = 30,
  maxSize: number = 100
): Record<string, number> {
  const values = importance.map((item) => {
    switch (importanceType) {
      case 'pageRank':
        return item.pageRank;
      case 'degree':
        return item.degreeCentrality;
      case 'betweenness':
        return item.betweennessCentrality;
      case 'closeness':
        return item.closenessCentrality;
    }
  });

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;

  const result: Record<string, number> = {};
  importance.forEach((item, index) => {
    const value = values[index] ?? 0;
    const normalized = range === 0 ? 0.5 : (value - minValue) / range;
    result[item.id] = minSize + normalized * (maxSize - minSize);
  });

  return result;
}
