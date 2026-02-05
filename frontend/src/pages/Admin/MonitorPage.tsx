/**
 * 系统监控页面 v3.0
 * 使用标准化 API + 实时图表
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Card,
  CardContent,
  Typography,
  Chip,
  AppBar,
  Toolbar,
  IconButton,
  Button,
  CircularProgress,
  Alert,
  LinearProgress,
  Stack,
} from '@mui/material';
import { 
  ArrowBack, 
  Refresh,
  Computer,
  Memory,
  Storage,
  Speed,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { monitorApi } from '../../services/adminService';
import type { HealthStatus, SystemStats } from '../../types/admin';
import SystemResourceChart from '../../components/Admin/Charts/SystemResourceChart';
import { useSystemMetrics } from '../../hooks/useSystemMetrics';

const MonitorPage: React.FC = () => {
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // 使用历史数据管理 Hook
  const { metricsHistory, addDataPoint } = useSystemMetrics({
    maxDataPoints: 30,
    updateInterval: 30000,
  });

  useEffect(() => {
    loadData();
    // 每 30 秒自动刷新
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [healthData, statsData] = await Promise.allSettled([
        monitorApi.getHealth(),
        monitorApi.getStats(),
      ]);
      
      if (healthData.status === 'fulfilled') {
        setHealth(healthData.value);
      }
      
      if (statsData.status === 'fulfilled') {
        setStats(statsData.value);
        // 添加到历史数据
        addDataPoint(statsData.value);
      }
    } catch (err: any) {
      console.error('加载数据失败:', err);
      setError(err.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'connected':
        return 'success';
      case 'unhealthy':
      case 'disconnected':
        return 'error';
      case 'degraded':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时 ${minutes}分钟`;
  };

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => navigate('/admin/dashboard')}
            sx={{ mr: 2 }}
          >
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            系统监控
          </Typography>
          <Button
            color="inherit"
            startIcon={<Refresh />}
            onClick={loadData}
            disabled={loading}
          >
            刷新
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {loading && !health && !stats && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        )}

        <Stack spacing={3}>
          {/* 系统健康状态 */}
          {health && (
            <Box>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">
                      系统健康状态
                    </Typography>
                    <Chip
                      label={health.status}
                      color={getStatusColor(health.status)}
                    />
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6">数据库</Typography>
                            <Chip
                              label={health.database.connected ? '已连接' : '断开'}
                              color={getStatusColor(health.database.connected ? 'connected' : 'disconnected')}
                              size="small"
                            />
                          </Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {health.database.message}
                          </Typography>
                        </CardContent>
                      </Card>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6">Neo4j</Typography>
                            <Chip
                              label={health.neo4j.connected ? '已连接' : '断开'}
                              color={getStatusColor(health.neo4j.connected ? 'connected' : 'disconnected')}
                              size="small"
                            />
                          </Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {health.neo4j.message}
                          </Typography>
                          {health.neo4j.nodes_count !== undefined && (
                            <Typography variant="body2" color="text.secondary">
                              节点: {health.neo4j.nodes_count.toLocaleString()}
                            </Typography>
                          )}
                          {health.neo4j.relationships_count !== undefined && (
                            <Typography variant="body2" color="text.secondary">
                              关系: {health.neo4j.relationships_count.toLocaleString()}
                            </Typography>
                          )}
                        </CardContent>
                      </Card>

                    {health.openai && (
                        <Card variant="outlined">
                          <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography variant="h6">OpenAI</Typography>
                              <Chip
                                label={health.openai.configured ? '已配置' : '未配置'}
                                color={getStatusColor(health.openai.configured ? 'connected' : 'disconnected')}
                                size="small"
                              />
                            </Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                              {health.openai.message}
                            </Typography>
                          </CardContent>
                        </Card>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Box>
          )}

          {/* 系统资源 */}
          {stats && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Computer sx={{ mr: 1 }} />
                      <Typography variant="h6">CPU</Typography>
                    </Box>
                    <Typography variant="h4" color="primary">
                      {stats.cpu_percent.toFixed(1)}%
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={stats.cpu_percent}
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Memory sx={{ mr: 1 }} />
                      <Typography variant="h6">内存</Typography>
                    </Box>
                    <Typography variant="h4" color="primary">
                      {stats.memory_percent.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatBytes(stats.memory_used_mb * 1024 * 1024)} / {formatBytes(stats.memory_total_mb * 1024 * 1024)}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={stats.memory_percent}
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Storage sx={{ mr: 1 }} />
                      <Typography variant="h6">磁盘</Typography>
                    </Box>
                    <Typography variant="h4" color="primary">
                      {stats.disk_percent.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {stats.disk_used_gb.toFixed(1)}GB / {stats.disk_total_gb.toFixed(1)}GB
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={stats.disk_percent}
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>
            </Box>
          )}

          {/* 实时资源趋势图 */}
          {metricsHistory.length > 0 && (
            <SystemResourceChart 
              data={metricsHistory}
              title="实时资源使用率趋势"
            />
          )}

          {stats && (
            <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Speed sx={{ mr: 1 }} />
                      <Typography variant="h6">系统信息</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      运行时间: {formatUptime(stats.uptime_seconds)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      最后更新: {new Date().toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      监控数据点: {metricsHistory.length} / 30
                    </Typography>
                  </CardContent>
                </Card>
          )}
        </Stack>
      </Container>
    </Box>
  );
};

export default MonitorPage;
