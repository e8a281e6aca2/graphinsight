import React, { useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { useGraphStore } from '../../store/graphStore';

interface NodeTypeStats {
  type: string;
  count: number;
  percentage: number;
  color: string;
}

interface EdgeTypeStats {
  type: string;
  count: number;
  percentage: number;
}

interface DegreeStats {
  nodeId: string;
  label: string;
  degree: number;
  inDegree: number;
  outDegree: number;
}

// 使用MUI主题颜色
const getNodeTypeColor = (index: number): string => {
  const colors = [
    '#1976d2', '#388e3c', '#f57c00', '#d32f2f', '#7b1fa2',
    '#0288d1', '#689f38', '#fbc02d', '#c2185b', '#5d4037'
  ];
  return colors[index % colors.length];
};

export const GraphStatsPanel: React.FC = () => {
  const { graphData, groupingState } = useGraphStore();
  
  const nodes = graphData?.nodes || [];
  const edges = graphData?.edges || [];

  // 计算节点类型统计
  const nodeTypeStats = useMemo((): NodeTypeStats[] => {
    const typeCount = new Map<string, number>();
    
    nodes.forEach((node: any) => {
      const labels = node.labels || ['Unknown'];
      labels.forEach((label: string) => {
        typeCount.set(label, (typeCount.get(label) || 0) + 1);
      });
    });

    const total = nodes.length;
    return Array.from(typeCount.entries())
      .map(([type, count], index) => ({
        type,
        count,
        percentage: Math.round((count / total) * 100),
        color: getNodeTypeColor(index)
      }))
      .sort((a, b) => b.count - a.count);
  }, [nodes]);

  // 计算边类型统计
  const edgeTypeStats = useMemo((): EdgeTypeStats[] => {
    const typeCount = new Map<string, number>();
    
    edges.forEach((edge: any) => {
      const type = edge.type || 'Unknown';
      typeCount.set(type, (typeCount.get(type) || 0) + 1);
    });

    const total = edges.length;
    return Array.from(typeCount.entries())
      .map(([type, count]) => ({
        type,
        count,
        percentage: Math.round((count / total) * 100)
      }))
      .sort((a, b) => b.count - a.count);
  }, [edges]);

  // 计算度分布统计
  const degreeStats = useMemo((): DegreeStats[] => {
    const degreeMap = new Map<string, { in: number; out: number }>();
    
    // 初始化所有节点的度为0
    nodes.forEach((node: any) => {
      degreeMap.set(node.id, { in: 0, out: 0 });
    });

    // 计算每个节点的入度和出度
    edges.forEach((edge: any) => {
      const source = edge.source;
      const target = edge.target;
      
      if (degreeMap.has(source)) {
        degreeMap.get(source)!.out++;
      }
      if (degreeMap.has(target)) {
        degreeMap.get(target)!.in++;
      }
    });

    return nodes
      .map((node: any) => {
        const degrees = degreeMap.get(node.id) || { in: 0, out: 0 };
        return {
          nodeId: node.id,
          label: node.properties?.name || node.id,
          degree: degrees.in + degrees.out,
          inDegree: degrees.in,
          outDegree: degrees.out
        };
      })
      .sort((a: any, b: any) => b.degree - a.degree)
      .slice(0, 10); // 只显示前10个高度节点
  }, [nodes, edges]);

  // 计算连通性统计
  const connectivityStats = useMemo(() => {
    const totalNodes = nodes.length;
    const totalEdges = edges.length;
    const avgDegree = totalNodes > 0 ? (totalEdges * 2) / totalNodes : 0;
    const density = totalNodes > 1 ? (totalEdges * 2) / (totalNodes * (totalNodes - 1)) : 0;
    
    return {
      totalNodes,
      totalEdges,
      avgDegree: Math.round(avgDegree * 100) / 100,
      density: Math.round(density * 10000) / 100, // 转换为百分比
      groupCount: groupingState.groups.length
    };
  }, [nodes, edges, groupingState]);

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        图谱统计分析
      </Typography>

      {/* 基础统计 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          基础统计
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="h4" color="primary">
                {connectivityStats.totalNodes}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                节点数量
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="h4" color="secondary">
                {connectivityStats.totalEdges}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                边数量
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="h4">
                {connectivityStats.avgDegree}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                平均度
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="h4">
                {connectivityStats.density}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                图密度
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Paper>

      {/* 节点类型分布 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          节点类型分布
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>类型</TableCell>
                <TableCell align="right">数量</TableCell>
                <TableCell align="right">占比</TableCell>
                <TableCell>分布</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {nodeTypeStats.map((stat) => (
                <TableRow key={stat.type}>
                  <TableCell>
                    <Chip
                      size="small"
                      label={stat.type}
                      sx={{ 
                        backgroundColor: stat.color,
                        color: 'white',
                        minWidth: 60
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">{stat.count}</TableCell>
                  <TableCell align="right">{stat.percentage}%</TableCell>
                  <TableCell sx={{ width: '40%' }}>
                    <LinearProgress
                      variant="determinate"
                      value={stat.percentage}
                      sx={{ 
                        height: 8, 
                        borderRadius: 4,
                        backgroundColor: 'grey.200',
                        '& .MuiLinearProgress-bar': {
                          backgroundColor: stat.color
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* 边类型分布 */}
      {edgeTypeStats.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            关系类型分布
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>关系类型</TableCell>
                  <TableCell align="right">数量</TableCell>
                  <TableCell align="right">占比</TableCell>
                  <TableCell>分布</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {edgeTypeStats.map((stat, index) => (
                  <TableRow key={stat.type}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                        {stat.type}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{stat.count}</TableCell>
                    <TableCell align="right">{stat.percentage}%</TableCell>
                    <TableCell sx={{ width: '40%' }}>
                      <LinearProgress
                        variant="determinate"
                        value={stat.percentage}
                        sx={{ 
                          height: 8, 
                          borderRadius: 4,
                          backgroundColor: 'grey.200',
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: getNodeTypeColor(index)
                          }
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* 高度节点排行 */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          高度节点排行 (Top 10)
        </Typography>
        <List dense>
          {degreeStats.map((stat, index) => (
            <ListItem key={stat.nodeId} divider={index < degreeStats.length - 1}>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      size="small"
                      label={`#${index + 1}`}
                      color={index < 3 ? 'primary' : 'default'}
                      sx={{ minWidth: 40 }}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                      {stat.label}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    总度: {stat.degree} (入度: {stat.inDegree}, 出度: {stat.outDegree})
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
};