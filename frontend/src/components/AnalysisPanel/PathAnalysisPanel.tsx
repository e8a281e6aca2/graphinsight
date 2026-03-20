import { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  List,
  ListItem,
  ListItemText,
  Chip,
  Alert,
  Divider,
  IconButton,
  Tooltip,
  Autocomplete,
} from '@mui/material';
import {
  Route as RouteIcon,
  Clear as ClearIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import type { RendererAPI, RendererEdge } from '../../renderers/core/types';
import { useGraphStore } from '../../store/graphStore';

interface PathAnalysisPanelProps {
  rendererRef: React.RefObject<RendererAPI | null>;
}

interface PathInfo {
  id: string;
  nodes: string[];
  edges: string[];
  length: number;
  weight: number;
}

interface NeighborLink {
  id: string;
  edgeId: string;
}

function buildAdjacency(edges: RendererEdge[]) {
  const adjacency = new Map<string, NeighborLink[]>();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push({ id: edge.target, edgeId: edge.id });
    adjacency.get(edge.target)!.push({ id: edge.source, edgeId: edge.id });
  });
  return adjacency;
}

function normalizeEdges(edges: RendererEdge[]) {
  return edges;
}

function findShortestPath(adjacency: Map<string, NeighborLink[]>, sourceId: string, targetId: string) {
  const queue: string[] = [sourceId];
  const visited = new Set<string>([sourceId]);
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) break;

    const neighbors = adjacency.get(current) || [];
    neighbors.forEach((neighbor) => {
      if (visited.has(neighbor.id)) return;
      visited.add(neighbor.id);
      prevNode.set(neighbor.id, current);
      prevEdge.set(neighbor.id, neighbor.edgeId);
      queue.push(neighbor.id);
    });
  }

  if (!visited.has(targetId)) return null;

  const nodes: string[] = [];
  const edges: string[] = [];
  let cursor = targetId;
  while (cursor !== sourceId) {
    nodes.push(cursor);
    const edgeId = prevEdge.get(cursor);
    if (edgeId) edges.push(edgeId);
    cursor = prevNode.get(cursor)!;
  }
  nodes.push(sourceId);

  return {
    nodes: nodes.reverse(),
    edges: edges.reverse(),
  };
}

function findAllSimplePaths(
  adjacency: Map<string, NeighborLink[]>,
  sourceId: string,
  targetId: string,
  maxLength: number
) {
  const paths: Array<{ nodes: string[]; edges: string[] }> = [];
  const queue: Array<{ current: string; path: string[]; edges: string[]; visited: Set<string> }> = [];

  queue.push({
    current: sourceId,
    path: [sourceId],
    edges: [],
    visited: new Set([sourceId]),
  });

  while (queue.length > 0 && paths.length < 100) {
    const { current, path, edges, visited } = queue.shift()!;

    if (path.length > maxLength) continue;

    if (current === targetId) {
      paths.push({ nodes: path, edges });
      continue;
    }

    const neighbors = adjacency.get(current) || [];
    neighbors.forEach((neighbor) => {
      if (visited.has(neighbor.id)) return;
      const nextVisited = new Set(visited);
      nextVisited.add(neighbor.id);
      queue.push({
        current: neighbor.id,
        path: [...path, neighbor.id],
        edges: [...edges, neighbor.edgeId],
        visited: nextVisited,
      });
    });
  }

  return paths;
}

export function PathAnalysisPanel({ rendererRef }: PathAnalysisPanelProps) {
  const graphData = useGraphStore((state) => state.graphData);
  const [sourceNode, setSourceNode] = useState<string>('');
  const [targetNode, setTargetNode] = useState<string>('');
  const [paths, setPaths] = useState<PathInfo[]>([]);
  const [highlightedPathId, setHighlightedPathId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const snapshot = useMemo(() => {
    if (!rendererRef.current) return null;
    const nodes = rendererRef.current.getAllNodes();
    const edges = normalizeEdges(rendererRef.current.getAllEdges());
    const labels = new Map(nodes.map((node) => [node.id, node.label || node.id] as const));
    return { nodes, edges, labels };
  }, [rendererRef, graphData?.stats?.executionTime]);

  const nodeOptions = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.nodes.map((node) => ({ id: node.id, label: node.label || node.id }));
  }, [snapshot]);

  const highlightPath = (path: PathInfo) => {
    if (!rendererRef.current) return;
    rendererRef.current.setPathHighlight({ nodeIds: path.nodes, edgeIds: path.edges });
    rendererRef.current.fitTo(path.nodes, 80);
    setHighlightedPathId(path.id);
  };

  const clearHighlight = () => {
    rendererRef.current?.clearPathHighlight();
    setHighlightedPathId(null);
  };

  const findShortestPathHandler = () => {
    if (!rendererRef.current || !snapshot || !sourceNode || !targetNode) {
      setError('请选择起点和终点节点');
      return;
    }

    if (sourceNode === targetNode) {
      setError('起点和终点不能相同');
      return;
    }

    setError('');
    const adjacency = buildAdjacency(snapshot.edges);
    const pathResult = findShortestPath(adjacency, sourceNode, targetNode);

    if (!pathResult) {
      setError('两个节点之间不存在路径');
      setPaths([]);
      return;
    }

    const pathInfo: PathInfo = {
      id: `path_${Date.now()}`,
      nodes: pathResult.nodes,
      edges: pathResult.edges,
      length: pathResult.nodes.length,
      weight: pathResult.edges.length,
    };

    setPaths([pathInfo]);
    highlightPath(pathInfo);
  };

  const findAllPathsHandler = () => {
    if (!rendererRef.current || !snapshot || !sourceNode || !targetNode) {
      setError('请选择起点和终点节点');
      return;
    }

    if (sourceNode === targetNode) {
      setError('起点和终点不能相同');
      return;
    }

    setError('');
    const adjacency = buildAdjacency(snapshot.edges);
    const allPaths = findAllSimplePaths(adjacency, sourceNode, targetNode, 6);

    if (allPaths.length === 0) {
      setError('两个节点之间不存在路径');
      setPaths([]);
      return;
    }

    const pathInfos: PathInfo[] = allPaths.map((path, index) => ({
      id: `path_${Date.now()}_${index}`,
      nodes: path.nodes,
      edges: path.edges,
      length: path.nodes.length,
      weight: path.edges.length,
    }));

    setPaths(pathInfos.slice(0, 10));

    if (pathInfos.length > 0) {
      highlightPath(pathInfos[0]);
    }
  };

  const clearAll = () => {
    setSourceNode('');
    setTargetNode('');
    setPaths([]);
    setError('');
    clearHighlight();
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <RouteIcon color="primary" />
        <Typography variant="h6">路径分析</Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Autocomplete
          options={nodeOptions}
          getOptionLabel={(option) => option.label}
          value={nodeOptions.find((n) => n.id === sourceNode) || null}
          onChange={(_, value) => setSourceNode(value?.id || '')}
          renderInput={(params) => <TextField {...params} label="起点节点" size="small" />}
          sx={{ mb: 1 }}
        />

        <Autocomplete
          options={nodeOptions}
          getOptionLabel={(option) => option.label}
          value={nodeOptions.find((n) => n.id === targetNode) || null}
          onChange={(_, value) => setTargetNode(value?.id || '')}
          renderInput={(params) => <TextField {...params} label="终点节点" size="small" />}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button
          variant="contained"
          size="small"
          onClick={findShortestPathHandler}
          disabled={!sourceNode || !targetNode}
          fullWidth
        >
          最短路径
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={findAllPathsHandler}
          disabled={!sourceNode || !targetNode}
          fullWidth
        >
          所有路径
        </Button>
        <Tooltip title="清除">
          <IconButton size="small" onClick={clearAll}>
            <ClearIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {paths.length > 0 && (
        <>
          <Typography variant="subtitle2" gutterBottom>
            找到 {paths.length} 条路径
          </Typography>

          <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
            <List dense>
              {paths.map((path, index) => (
                <Box key={path.id}>
                  <ListItem
                    secondaryAction={
                      <Tooltip title={highlightedPathId === path.id ? '取消高亮' : '高亮路径'}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (highlightedPathId === path.id) {
                              clearHighlight();
                            } else {
                              highlightPath(path);
                            }
                          }}
                        >
                          {highlightedPathId === path.id ? (
                            <VisibilityOffIcon fontSize="small" />
                          ) : (
                            <VisibilityIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    }
                    sx={{
                      backgroundColor: highlightedPathId === path.id ? 'action.selected' : 'transparent',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip label={`路径 ${index + 1}`} size="small" />
                          <Chip label={`${path.length} 节点`} size="small" variant="outlined" />
                          <Chip label={`${path.weight} 跳`} size="small" variant="outlined" />
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                          {path.nodes.map((nodeId, i) => (
                            <span key={nodeId}>
                              {snapshot?.labels.get(nodeId) || nodeId}
                              {i < path.nodes.length - 1 && ' → '}
                            </span>
                          ))}
                        </Typography>
                      }
                    />
                  </ListItem>
                  {index < paths.length - 1 && <Divider />}
                </Box>
              ))}
            </List>
          </Paper>

          <Box sx={{ mt: 2, p: 1.5, backgroundColor: 'background.default', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              提示: 点击眼睛图标可以在图谱中高亮显示对应的路径
            </Typography>
          </Box>
        </>
      )}

      {paths.length === 0 && !error && (
        <Alert severity="info">
          选择起点和终点节点，然后点击"最短路径"或"所有路径"按钮进行分析
        </Alert>
      )}
    </Box>
  );
}
