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
import type { Core } from 'cytoscape';
import { analyzeNodeImportance, applyImportanceToNodeSize, type NodeImportance } from '../../utils/graphAnalysis';

interface NodeImportancePanelProps {
  cyRef: React.RefObject<Core | null>;
}

type ImportanceMetric = 'pageRank' | 'degree' | 'betweenness' | 'closeness';

export function NodeImportancePanel({ cyRef }: NodeImportancePanelProps) {
  const [importance, setImportance] = useState<NodeImportance[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<ImportanceMetric>('pageRank');
  const [appliedToSize, setAppliedToSize] = useState(false);

  // 执行分析
  const runAnalysis = () => {
    if (!cyRef.current) return;

    setLoading(true);
    try {
      const results = analyzeNodeImportance(cyRef.current);
      setImportance(results);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    if (cyRef.current && cyRef.current.nodes().length > 0) {
      runAnalysis();
    }
  }, [cyRef]);

  // 应用到节点大小
  const handleApplyToSize = () => {
    if (!cyRef.current) return;

    applyImportanceToNodeSize(cyRef.current, selectedMetric);
    setAppliedToSize(true);
  };

  // 重置节点大小
  const handleResetSize = () => {
    if (!cyRef.current) return;

    cyRef.current.nodes().style({
      width: 60,
      height: 60,
    });
    setAppliedToSize(false);
  };

  // 定位到节点
  const handleLocateNode = (nodeId: string) => {
    if (!cyRef.current) return;

    const node = cyRef.current.getElementById(nodeId);
    if (node.length > 0) {
      cyRef.current.animate({
        center: { eles: node },
        zoom: Math.max(cyRef.current.zoom(), 1.5),
      }, {
        duration: 500,
      });
      node.select();
    }
  };

  // 获取排序后的节点列表
  const getSortedNodes = () => {
    return [...importance].sort((a, b) => {
      switch (selectedMetric) {
        case 'pageRank': return b.pageRank - a.pageRank;
        case 'degree': return b.degreeCentrality - a.degreeCentrality;
        case 'betweenness': return b.betweennessCentrality - a.betweennessCentrality;
        case 'closeness': return b.closenessCentrality - a.closenessCentrality;
      }
    });
  };

  // 格式化数值
  const formatValue = (value: number) => {
    return value.toFixed(4);
  };

  // 获取指标值
  const getMetricValue = (node: NodeImportance) => {
    switch (selectedMetric) {
      case 'pageRank': return node.pageRank;
      case 'degree': return node.degreeCentrality;
      case 'betweenness': return node.betweennessCentrality;
      case 'closeness': return node.closenessCentrality;
    }
  };

  const sortedNodes = getSortedNodes();
  const topNodes = sortedNodes.slice(0, 10);

  return (
    <Box sx={{ p: 2 }}>
      {/* 标题和操作 */}
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

      {/* 指标选择 */}
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

      {/* 应用到节点大小 */}
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
          <Button
            variant="outlined"
            size="small"
            onClick={handleResetSize}
            fullWidth
          >
            重置大小
          </Button>
        )}
      </Box>

      {/* 加载状态 */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* 结果表格 */}
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
                  <TableCell align="right">
                    {selectedMetric === 'pageRank' && 'PageRank'}
                    {selectedMetric === 'degree' && '度中心性'}
                    {selectedMetric === 'betweenness' && '介数中心性'}
                    {selectedMetric === 'closeness' && '接近中心性'}
                  </TableCell>
                  <TableCell align="center">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topNodes.map((node, index) => (
                  <TableRow
                    key={node.id}
                    hover
                    sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                  >
                    <TableCell>
                      <Chip
                        label={index + 1}
                        size="small"
                        color={index < 3 ? 'primary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>
                        {node.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {node.id}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight="bold">
                        {formatValue(getMetricValue(node))}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="定位节点">
                        <IconButton
                          size="small"
                          onClick={() => handleLocateNode(node.id)}
                        >
                          <ZoomInIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* 指标说明 */}
          <Box sx={{ mt: 2, p: 1.5, backgroundColor: 'background.default', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {selectedMetric === 'pageRank' && '提示: PageRank: 基于链接结构计算节点重要性，值越大表示节点越重要'}
              {selectedMetric === 'degree' && '提示: 度中心性: 节点的连接数量，值越大表示连接越多'}
              {selectedMetric === 'betweenness' && '提示: 介数中心性: 节点在最短路径中的出现频率，值越大表示桥接作用越强'}
              {selectedMetric === 'closeness' && '提示: 接近中心性: 节点到其他节点的平均距离的倒数，值越大表示越接近图谱中心'}
            </Typography>
          </Box>
        </>
      )}

      {/* 空状态 */}
      {!loading && importance.length === 0 && (
        <Alert severity="info">
          暂无数据，请先执行查询加载图谱数据
        </Alert>
      )}
    </Box>
  );
}
