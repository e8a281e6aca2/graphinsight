import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
  Tooltip,
  IconButton,
  Alert,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  Refresh as RefreshIcon,
  ZoomIn as ZoomInIcon,
} from '@mui/icons-material';
import type { RendererAPI } from '../../renderers/core/types';
import { analyzeNodeImportance, getNodeSizeOverrides, type NodeImportance } from '../../utils/graphAnalysis';
import { useGraphStore } from '../../store/graphStore';

interface NodeImportancePanelProps {
  rendererRef: React.RefObject<RendererAPI | null>;
}

type ImportanceMetric = 'pageRank' | 'degree' | 'betweenness' | 'closeness';

function getGraphSnapshot(renderer: RendererAPI) {
  const nodes = renderer.getAllNodes();
  const edges = renderer.getAllEdges();
  return { nodes, edges };
}

export function NodeImportancePanel({ rendererRef }: NodeImportancePanelProps) {
  const graphData = useGraphStore((state) => state.graphData);
  const [importance, setImportance] = useState<NodeImportance[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<ImportanceMetric>('pageRank');
  const [appliedToSize, setAppliedToSize] = useState(false);

  const runAnalysis = () => {
    if (!rendererRef.current) return;

    setLoading(true);
    try {
      const snapshot = getGraphSnapshot(rendererRef.current);
      const results = analyzeNodeImportance(snapshot);
      setImportance(results);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!rendererRef.current) return;
    if (rendererRef.current.getAllNodes().length > 0) {
      runAnalysis();
    }
  }, [rendererRef, graphData?.stats?.executionTime]);

  const handleApplyToSize = () => {
    if (!rendererRef.current || importance.length === 0) return;
    const overrides = getNodeSizeOverrides(importance, selectedMetric);
    rendererRef.current.setNodeSizeOverrides(overrides);
    setAppliedToSize(true);
  };

  const handleResetSize = () => {
    if (!rendererRef.current) return;
    rendererRef.current.setNodeSizeOverrides(null);
    setAppliedToSize(false);
  };

  const handleLocateNode = (nodeId: string) => {
    if (!rendererRef.current) return;
    rendererRef.current.setActiveElement({ type: 'node', id: nodeId });
    rendererRef.current.fitTo([nodeId], 120);
  };

  const getSortedNodes = () => {
    return [...importance].sort((a, b) => {
      switch (selectedMetric) {
        case 'pageRank':
          return b.pageRank - a.pageRank;
        case 'degree':
          return b.degreeCentrality - a.degreeCentrality;
        case 'betweenness':
          return b.betweennessCentrality - a.betweennessCentrality;
        case 'closeness':
          return b.closenessCentrality - a.closenessCentrality;
      }
    });
  };

  const formatValue = (value: number) => {
    return value.toFixed(4);
  };

  const getMetricValue = (node: NodeImportance) => {
    switch (selectedMetric) {
      case 'pageRank':
        return node.pageRank;
      case 'degree':
        return node.degreeCentrality;
      case 'betweenness':
        return node.betweennessCentrality;
      case 'closeness':
        return node.closenessCentrality;
    }
  };

  const sortedNodes = getSortedNodes();
  const topNodes = sortedNodes.slice(0, 10);

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TrendingUpIcon color="primary" />
          <Typography variant="h6">节点重要性分析</Typography>
        </Box>

        <Tooltip title="刷新分析">
          <IconButton size="small" onClick={runAnalysis} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          选择指标
        </Typography>
        <ToggleButtonGroup
          value={selectedMetric}
          exclusive
          onChange={(_, value) => value && setSelectedMetric(value)}
          size="small"
          fullWidth
        >
          <ToggleButton value="pageRank">
            <Tooltip title="基于链接结构的重要性">
              <span>PageRank</span>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="degree">
            <Tooltip title="连接数量">
              <span>度中心性</span>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="betweenness">
            <Tooltip title="桥接作用">
              <span>介数中心性</span>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="closeness">
            <Tooltip title="到其他节点的平均距离">
              <span>接近中心性</span>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
        <Button
          variant={appliedToSize ? 'outlined' : 'contained'}
          size="small"
          onClick={handleApplyToSize}
          disabled={loading || importance.length === 0}
          fullWidth
        >
          应用到节点大小
        </Button>
        {appliedToSize && (
          <Button variant="outlined" size="small" onClick={handleResetSize} fullWidth>
            重置大小
          </Button>
        )}
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && importance.length > 0 && (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            显示前 10 个最重要的节点（共 {importance.length} 个节点）
          </Alert>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>排名</TableCell>
                  <TableCell>节点</TableCell>
                  <TableCell align="right">指标值</TableCell>
                  <TableCell align="center">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topNodes.map((node, index) => (
                  <TableRow key={node.id}>
                    <TableCell>
                      <Chip
                        label={index + 1}
                        size="small"
                        color={index < 3 ? 'primary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {node.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {node.id}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {formatValue(getMetricValue(node))}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="定位节点">
                        <IconButton size="small" onClick={() => handleLocateNode(node.id)}>
                          <ZoomInIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
