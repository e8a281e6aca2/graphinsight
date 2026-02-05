/**
 * 图谱分析工具
 * 提供节点重要性分析、中心性计算等功能
 */

import type { Core, NodeSingular } from 'cytoscape';

export interface NodeImportance {
  id: string;
  label: string;
  pageRank: number;
  degreeCentrality: number;
  betweennessCentrality: number;
  closenessCentrality: number;
}

/**
 * PageRank 算法
 * 计算节点的 PageRank 值
 */
export function calculatePageRank(
  cy: Core,
  dampingFactor: number = 0.85,
  maxIterations: number = 100,
  tolerance: number = 0.0001
): Map<string, number> {
  const nodes = cy.nodes();
  const nodeCount = nodes.length;
  
  if (nodeCount === 0) {
    return new Map();
  }

  // 初始化 PageRank 值
  const pageRank = new Map<string, number>();
  const newPageRank = new Map<string, number>();
  
  nodes.forEach(node => {
    pageRank.set(node.id(), 1 / nodeCount);
  });

  // 迭代计算
  for (let iter = 0; iter < maxIterations; iter++) {
    let diff = 0;

    nodes.forEach(node => {
      const nodeId = node.id();
      
      // 计算来自其他节点的 PageRank 贡献
      let sum = 0;
      const incomers = node.incomers('node');
      
      incomers.forEach(incomer => {
        const incomerId = incomer.id();
        const outDegree = incomer.outdegree();
        
        if (outDegree > 0) {
          sum += (pageRank.get(incomerId) || 0) / outDegree;
        }
      });

      // PageRank 公式: (1-d)/N + d * sum
      const newValue = (1 - dampingFactor) / nodeCount + dampingFactor * sum;
      newPageRank.set(nodeId, newValue);
      
      diff += Math.abs(newValue - (pageRank.get(nodeId) || 0));
    });

    // 更新 PageRank 值
    newPageRank.forEach((value, key) => {
      pageRank.set(key, value);
    });

    // 检查收敛
    if (diff < tolerance) {
      console.log(`PageRank converged after ${iter + 1} iterations`);
      break;
    }
  }

  return pageRank;
}

/**
 * 度中心性
 * 计算节点的度中心性（连接数）
 */
export function calculateDegreeCentrality(cy: Core): Map<string, number> {
  const centrality = new Map<string, number>();
  const nodes = cy.nodes();
  const nodeCount = nodes.length;

  if (nodeCount <= 1) {
    nodes.forEach(node => centrality.set(node.id(), 0));
    return centrality;
  }

  nodes.forEach(node => {
    const degree = node.degree();
    // 归一化: degree / (n - 1)
    const normalizedDegree = degree / (nodeCount - 1);
    centrality.set(node.id(), normalizedDegree);
  });

  return centrality;
}

/**
 * 介数中心性（简化版）
 * 计算节点在最短路径中出现的频率
 */
export function calculateBetweennessCentrality(cy: Core): Map<string, number> {
  const centrality = new Map<string, number>();
  const nodes = cy.nodes();

  // 初始化
  nodes.forEach(node => centrality.set(node.id(), 0));

  // 对每对节点计算最短路径
  nodes.forEach(source => {
    nodes.forEach(target => {
      if (source.id() === target.id()) return;

      // 使用 Dijkstra 算法找最短路径
      const dijkstra = cy.elements().dijkstra({
        root: source,
        weight: () => 1,
        directed: false,
      });

      const path = dijkstra.pathTo(target);
      
      // 统计路径中的节点
      path.nodes().forEach(node => {
        if (node.id() !== source.id() && node.id() !== target.id()) {
          const current = centrality.get(node.id()) || 0;
          centrality.set(node.id(), current + 1);
        }
      });
    });
  });

  // 归一化
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
 * 计算节点到其他所有节点的平均最短路径长度的倒数
 */
export function calculateClosenessCentrality(cy: Core): Map<string, number> {
  const centrality = new Map<string, number>();
  const nodes = cy.nodes();
  const nodeCount = nodes.length;

  if (nodeCount <= 1) {
    nodes.forEach(node => centrality.set(node.id(), 0));
    return centrality;
  }

  nodes.forEach(node => {
    const dijkstra = cy.elements().dijkstra({
      root: node,
      weight: () => 1,
      directed: false,
    });

    let totalDistance = 0;
    let reachableCount = 0;

    nodes.forEach(target => {
      if (node.id() === target.id()) return;

      const distance = dijkstra.distanceTo(target);
      
      if (distance !== Infinity && distance > 0) {
        totalDistance += distance;
        reachableCount++;
      }
    });

    // 接近中心性 = (可达节点数 - 1) / 总距离
    if (totalDistance > 0 && reachableCount > 0) {
      const closeness = reachableCount / totalDistance;
      centrality.set(node.id(), closeness);
    } else {
      centrality.set(node.id(), 0);
    }
  });

  return centrality;
}

/**
 * 综合节点重要性分析
 */
export function analyzeNodeImportance(cy: Core): NodeImportance[] {
  console.log('Starting node importance analysis...');

  const pageRankMap = calculatePageRank(cy);
  const degreeMap = calculateDegreeCentrality(cy);
  const betweennessMap = calculateBetweennessCentrality(cy);
  const closenessMap = calculateClosenessCentrality(cy);

  const results: NodeImportance[] = [];

  cy.nodes().forEach(node => {
    const id = node.id();
    results.push({
      id,
      label: node.data('label') || id,
      pageRank: pageRankMap.get(id) || 0,
      degreeCentrality: degreeMap.get(id) || 0,
      betweennessCentrality: betweennessMap.get(id) || 0,
      closenessCentrality: closenessMap.get(id) || 0,
    });
  });

  console.log('Node importance analysis completed');
  return results;
}

/**
 * 根据重要性调整节点大小
 */
export function applyImportanceToNodeSize(
  cy: Core,
  importanceType: 'pageRank' | 'degree' | 'betweenness' | 'closeness',
  minSize: number = 30,
  maxSize: number = 100
): void {
  const importance = analyzeNodeImportance(cy);
  
  // 获取对应的重要性值
  const values = importance.map(item => {
    switch (importanceType) {
      case 'pageRank': return item.pageRank;
      case 'degree': return item.degreeCentrality;
      case 'betweenness': return item.betweennessCentrality;
      case 'closeness': return item.closenessCentrality;
    }
  });

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;

  // 应用大小
  importance.forEach(item => {
    const node = cy.getElementById(item.id);
    if (node.length === 0) return;

    let value: number;
    switch (importanceType) {
      case 'pageRank': value = item.pageRank; break;
      case 'degree': value = item.degreeCentrality; break;
      case 'betweenness': value = item.betweennessCentrality; break;
      case 'closeness': value = item.closenessCentrality; break;
    }

    // 归一化到 [minSize, maxSize]
    const normalizedValue = range > 0 ? (value - minValue) / range : 0.5;
    const size = minSize + normalizedValue * (maxSize - minSize);

    node.style({
      width: size,
      height: size,
    });
  });

  console.log(`Applied ${importanceType} to node sizes`);
}
