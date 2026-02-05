import { useState } from 'react';
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
import type { Core } from 'cytoscape';

interface PathAnalysisPanelProps {
  cyRef: React.RefObject<Core | null>;
}

interface PathInfo {
  id: string;
  nodes: string[];
  edges: string[];
  length: number;
  weight: number;
}

export function PathAnalysisPanel({ cyRef }: PathAnalysisPanelProps) {
  const [sourceNode, setSourceNode] = useState<string>('');
  const [targetNode, setTargetNode] = useState<string>('');
  const [paths, setPaths] = useState<PathInfo[]>([]);
  const [highlightedPathId, setHighlightedPathId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  // 获取所有节点选项
  const getNodeOptions = () => {
    if (!cyRef.current) return [];
    
    return cyRef.current.nodes().map(node => ({
      id: node.id(),
      label: node.data('label') || node.id(),
    }));
  };

  // 查找最短路径
  const findShortestPath = () => {
    if (!cyRef.current || !sourceNode || !targetNode) {
      setError('请选择起点和终点节点');
      return;
    }

    if (sourceNode === targetNode) {
      setError('起点和终点不能相同');
      return;
    }

    setError('');
    const cy = cyRef.current;
    
    const source = cy.getElementById(sourceNode);
    const target = cy.getElementById(targetNode);

    if (source.length === 0 || target.length === 0) {
      setError('节点不存在');
      return;
    }

    try {
      // 使用 Dijkstra 算法
      const dijkstra = cy.elements().dijkstra({
        root: source,
        weight: () => 1,
        directed: false,
      });

      const pathElements = dijkstra.pathTo(target);
      const distance = dijkstra.distanceTo(target);

      if (distance === Infinity) {
        setError('两个节点之间不存在路径');
        setPaths([]);
        return;
      }

      const pathNodes = pathElements.nodes().map(n => n.id());
      const pathEdges = pathElements.edges().map(e => e.id());

      const pathInfo: PathInfo = {
        id: `path_${Date.now()}`,
        nodes: pathNodes,
        edges: pathEdges,
        length: pathNodes.length,
        weight: distance,
      };

      setPaths([pathInfo]);
      highlightPath(pathInfo);
    } catch (err) {
      console.error('Path finding error:', err);
      setError('路径查找失败');
    }
  };

  // 查找所有简单路径（限制长度避免性能问题）
  const findAllPaths = () => {
    if (!cyRef.current || !sourceNode || !targetNode) {
      setError('请选择起点和终点节点');
      return;
    }

    if (sourceNode === targetNode) {
      setError('起点和终点不能相同');
      return;
    }

    setError('');
    const cy = cyRef.current;
    
    const source = cy.getElementById(sourceNode);
    const target = cy.getElementById(targetNode);

    if (source.length === 0 || target.length === 0) {
      setError('节点不存在');
      return;
    }

    try {
      // 使用 BFS 查找多条路径（限制最大长度为 6）
      const allPaths = findAllSimplePaths(cy, sourceNode, targetNode, 6);
      
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

      setPaths(pathInfos.slice(0, 10)); // 最多显示 10 条路径
      
      if (pathInfos.length > 0) {
        highlightPath(pathInfos[0]);
      }
    } catch (err) {
      console.error('Path finding error:', err);
      setError('路径查找失败');
    }
  };

  // BFS 查找所有简单路径
  const findAllSimplePaths = (
    cy: Core,
    sourceId: string,
    targetId: string,
    maxLength: number
  ): Array<{ nodes: string[]; edges: string[] }> => {
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

      const currentNode = cy.getElementById(current);
      const neighbors = currentNode.neighborhood('node');

      neighbors.forEach(neighbor => {
        const neighborId = neighbor.id();
        
        if (!visited.has(neighborId)) {
          const edge = currentNode.edgesWith(neighbor);
          const edgeId = edge.length > 0 ? edge[0].id() : '';
          const newVisited = new Set(visited);
          newVisited.add(neighborId);

          queue.push({
            current: neighborId,
            path: [...path, neighborId],
            edges: edgeId ? [...edges, edgeId] : edges,
            visited: newVisited,
          });
        }
      });
    }

    return paths;
  };

  // 高亮路径
  const highlightPath = (path: PathInfo) => {
    if (!cyRef.current) {
      console.error('cyRef.current is null');
      return;
    }

    const cy = cyRef.current;
    console.log('🎨 Highlighting path:', path);
    
    // 清除之前的高亮
    cy.elements().removeClass('path-highlight');
    cy.elements().removeClass('path-node');
    cy.elements().removeClass('path-edge');

    // 高亮新路径
    let highlightedNodes = 0;
    let highlightedEdges = 0;

    path.nodes.forEach(nodeId => {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        node.addClass('path-node');
        highlightedNodes++;
        console.log('Highlighted node:', nodeId);
      } else {
        console.warn('Node not found:', nodeId);
      }
    });

    path.edges.forEach(edgeId => {
      const edge = cy.getElementById(edgeId);
      if (edge.length > 0) {
        edge.addClass('path-edge');
        highlightedEdges++;
        console.log('Highlighted edge:', edgeId);
      } else {
        console.warn('Edge not found:', edgeId);
      }
    });

    console.log(`🎨 Highlighted ${highlightedNodes} nodes and ${highlightedEdges} edges`);
    setHighlightedPathId(path.id);

    // 居中显示路径
    const pathElements = cy.collection();
    path.nodes.forEach(id => {
      const node = cy.getElementById(id);
      if (node.length > 0) pathElements.merge(node);
    });
    path.edges.forEach(id => {
      const edge = cy.getElementById(id);
      if (edge.length > 0) pathElements.merge(edge);
    });

    if (pathElements.length > 0) {
      cy.animate({
        fit: { eles: pathElements, padding: 50 },
      }, {
        duration: 500,
      });
    }
  };

  // 清除高亮
  const clearHighlight = () => {
    if (!cyRef.current) return;

    cyRef.current.elements().removeClass('path-highlight');
    cyRef.current.elements().removeClass('path-node');
    cyRef.current.elements().removeClass('path-edge');
    setHighlightedPathId(null);
  };

  // 清除所有
  const clearAll = () => {
    setSourceNode('');
    setTargetNode('');
    setPaths([]);
    setError('');
    clearHighlight();
  };

  const nodeOptions = getNodeOptions();

  return (
    <Box sx={{ p: 2 }}>
      {/* 标题 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <RouteIcon color="primary" />
        <Typography variant="h6">路径分析</Typography>
      </Box>

      {/* 节点选择 */}
      <Box sx={{ mb: 2 }}>
        <Autocomplete
          options={nodeOptions}
          getOptionLabel={(option) => option.label}
          value={nodeOptions.find(n => n.id === sourceNode) || null}
          onChange={(_, value) => setSourceNode(value?.id || '')}
          renderInput={(params) => (
            <TextField {...params} label="起点节点" size="small" />
          )}
          sx={{ mb: 1 }}
        />

        <Autocomplete
          options={nodeOptions}
          getOptionLabel={(option) => option.label}
          value={nodeOptions.find(n => n.id === targetNode) || null}
          onChange={(_, value) => setTargetNode(value?.id || '')}
          renderInput={(params) => (
            <TextField {...params} label="终点节点" size="small" />
          )}
        />
      </Box>

      {/* 操作按钮 */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button
          variant="contained"
          size="small"
          onClick={findShortestPath}
          disabled={!sourceNode || !targetNode}
          fullWidth
        >
          最短路径
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={findAllPaths}
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

      {/* 错误提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* 路径列表 */}
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
                          {path.nodes.map((nodeId, i) => {
                            const node = cyRef.current?.getElementById(nodeId);
                            const label = node?.data('label') || nodeId;
                            return (
                              <span key={nodeId}>
                                {label}
                                {i < path.nodes.length - 1 && ' → '}
                              </span>
                            );
                          })}
                        </Typography>
                      }
                    />
                  </ListItem>
                  {index < paths.length - 1 && <Divider />}
                </Box>
              ))}
            </List>
          </Paper>

          {/* 说明 */}
          <Box sx={{ mt: 2, p: 1.5, backgroundColor: 'background.default', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              提示: 点击眼睛图标可以在图谱中高亮显示对应的路径
            </Typography>
          </Box>
        </>
      )}

      {/* 空状态 */}
      {paths.length === 0 && !error && (
        <Alert severity="info">
          选择起点和终点节点，然后点击"最短路径"或"所有路径"按钮进行分析
        </Alert>
      )}
    </Box>
  );
}
