/**
 * 管理系统仪表盘 v3.0
 * 使用标准化 API + 图表展示
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Card,
  CardContent,
  Typography,
  Button,
  AppBar,
  Toolbar,
  Chip,
  CircularProgress,
  Alert,
  LinearProgress,
  IconButton,
  Stack,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Security as SecurityIcon,
  Refresh as RefreshIcon,
  Computer as ComputerIcon,
  Memory as MemoryIcon,
  ArrowBack,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { monitorApi, logApi } from '../../services/adminService';
import type { SystemStats, HealthStatus, LogStats } from '../../types/admin';
import SystemResourceChart from '../../components/Admin/Charts/SystemResourceChart';
import LogStatsChart from '../../components/Admin/Charts/LogStatsChart';
import { useSystemMetrics } from '../../hooks/useSystemMetrics';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // 使用历史数据管理 Hook
  const { metricsHistory, addDataPoint } = useSystemMetrics({
    maxDataPoints: 20,
    updateInterval: 30000,
  });

  useEffect(() => {
    fetchStats();
    // 每 30 秒自动刷新
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError('');
      
      // 检查是否有 token
      const token = localStorage.getItem('admin_token');
      console.log('Dashboard - Token check:', !!token);
      if (!token) {
        console.log('No token found, redirecting to login');
        navigate('/admin/login');
        return;
      }
      
      console.log('Dashboard - 开始获取数据...');
      
      // 并行获取多个统计信息
      const [systemData, healthData, logData] = await Promise.allSettled([
        monitorApi.getStats(),
        monitorApi.getHealth(),
        logApi.getStats(),
      ]);
      
      console.log('Dashboard - 数据获取结果:', {
        system: systemData.status,
        health: healthData.status,
        log: logData.status
      });
      
      if (systemData.status === 'fulfilled') {
        console.log('Dashboard - 系统数据:', systemData.value);
        setSystemStats(systemData.value);
        // 添加到历史数据
        addDataPoint(systemData.value);
      } else {
        console.error('Dashboard - 系统数据失败:', systemData.reason);
      }
      
      if (healthData.status === 'fulfilled') {
        console.log('Dashboard - 健康数据:', healthData.value);
        setHealthStatus(healthData.value);
      } else {
        console.error('Dashboard - 健康数据失败:', healthData.reason);
      }
      
      if (logData.status === 'fulfilled') {
        console.log('Dashboard - 日志数据:', logData.value);
        setLogStats(logData.value);
      } else {
        console.error('Dashboard - 日志数据失败:', logData.reason);
      }
      
      // 即使部分数据加载失败,也不显示错误,只在控制台记录
      console.log('Dashboard - 数据加载完成');
      
    } catch (err: any) {
      console.error('Dashboard error:', err);
      // 不设置错误,让页面显示已加载的数据
      console.error('Dashboard 加载出错,但继续显示可用数据');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): 'success' | 'error' | 'warning' | 'default' => {
    switch (status.toLowerCase()) {
      case 'connected':
      case 'healthy':
        return 'success';
      case 'disconnected':
      case 'unhealthy':
        return 'error';
      case 'degraded':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时 ${minutes}分钟`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => navigate('/')}
            sx={{ mr: 2 }}
          >
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            系统仪表板
          </Typography>
          <Button
            color="inherit"
            onClick={() => navigate('/admin/config')}
            sx={{ mr: 2 }}
          >
            基础配置
          </Button>
          <Button
            color="inherit"
            onClick={() => navigate('/admin/analytics')}
            sx={{ mr: 2 }}
          >
            数据分析
          </Button>
          <Button
            color="inherit"
            onClick={() => navigate('/admin/profile')}
            sx={{ mr: 2 }}
          >
            个人设置
          </Button>
          <Button
            color="inherit"
            startIcon={<RefreshIcon />}
            onClick={fetchStats}
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

        {loading && !systemStats && !healthStatus ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 4 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              正在加载数据...
            </Typography>
          </Box>
        ) : null}
        
        {/* 始终显示内容区域,即使在加载中 */}
        <Stack spacing={3} sx={{ display: (loading && !systemStats && !healthStatus) ? 'none' : 'flex' }}>
            {/* 系统健康状态 */}
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <DashboardIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">系统健康状态</Typography>
                </Box>
                {healthStatus ? (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={`整体: ${healthStatus.status === 'healthy' ? '健康' : healthStatus.status === 'degraded' ? '降级' : '异常'}`}
                      color={getStatusColor(healthStatus.status)}
                    />
                    <Chip
                      label={`PostgreSQL: ${healthStatus.database.connected ? '已连接' : '断开'}`}
                      color={getStatusColor(healthStatus.database.connected ? 'connected' : 'disconnected')}
                      size="small"
                    />
                    <Chip
                      label={`Neo4j: ${healthStatus.neo4j.connected ? '已连接' : '断开'}`}
                      color={getStatusColor(healthStatus.neo4j.connected ? 'connected' : 'disconnected')}
                      size="small"
                    />
                    {healthStatus.ai_service && (
                      <Chip
                        label={`AI服务: ${healthStatus.ai_service.connected ? '已配置' : '未配置'}`}
                        color={getStatusColor(healthStatus.ai_service.connected ? 'connected' : 'disconnected')}
                        size="small"
                      />
                    )}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    正在加载健康状态...
                  </Typography>
                )}
              </CardContent>
            </Card>

            {/* 系统资源 */}
            {systemStats && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <ComputerIcon sx={{ mr: 1 }} />
                      <Typography variant="h6">CPU</Typography>
                    </Box>
                    <Typography variant="h4" color="primary">
                      {systemStats.cpu_percent.toFixed(1)}%
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemStats.cpu_percent}
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <MemoryIcon sx={{ mr: 1 }} />
                      <Typography variant="h6">内存</Typography>
                    </Box>
                    <Typography variant="h4" color="primary">
                      {systemStats.memory_percent.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatBytes(systemStats.memory_used_mb * 1024 * 1024)} / {formatBytes(systemStats.memory_total_mb * 1024 * 1024)}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemStats.memory_percent}
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <StorageIcon sx={{ mr: 1 }} />
                      <Typography variant="h6">磁盘</Typography>
                    </Box>
                    <Typography variant="h4" color="primary">
                      {systemStats.disk_percent.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemStats.disk_used_gb.toFixed(1)}GB / {systemStats.disk_total_gb.toFixed(1)}GB
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemStats.disk_percent}
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>
              </Box>
            )}

            {/* 服务状态卡片 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
              {/* Neo4j 数据库 */}
              {healthStatus?.neo4j && (
                <Card 
                  sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}
                  onClick={() => navigate('/admin/config?tab=0')}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <StorageIcon sx={{ mr: 1, color: healthStatus.neo4j.connected ? 'success.main' : 'error.main' }} />
                      <Typography variant="h6">Neo4j 图数据库</Typography>
                    </Box>
                    <Chip 
                      label={healthStatus.neo4j.connected ? '已连接' : '断开'} 
                      color={healthStatus.neo4j.connected ? 'success' : 'error'}
                      size="small"
                      sx={{ mb: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {healthStatus.neo4j.uri}
                    </Typography>
                    {healthStatus.neo4j.connected && (
                      <>
                        {healthStatus.neo4j.nodes_count !== undefined && healthStatus.neo4j.nodes_count !== null && (
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            节点: {healthStatus.neo4j.nodes_count.toLocaleString()}
                          </Typography>
                        )}
                        {healthStatus.neo4j.relationships_count !== undefined && healthStatus.neo4j.relationships_count !== null && (
                          <Typography variant="body2" color="text.secondary">
                            关系: {healthStatus.neo4j.relationships_count.toLocaleString()}
                          </Typography>
                        )}
                      </>
                    )}
                    {!healthStatus.neo4j.connected && healthStatus.neo4j.error && (
                      <Typography variant="caption" color="error">
                        {healthStatus.neo4j.error}
                      </Typography>
                    )}
                    <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 1 }}>
                      点击配置 →
                    </Typography>
                  </CardContent>
                </Card>
              )}

              {/* AI 服务 */}
              {healthStatus?.ai_service && (
                <Card 
                  sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}
                  onClick={() => navigate('/admin/config?tab=1')}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <SpeedIcon sx={{ mr: 1, color: healthStatus.ai_service.connected ? 'success.main' : 'warning.main' }} />
                      <Typography variant="h6">AI 服务</Typography>
                    </Box>
                    <Chip 
                      label={healthStatus.ai_service.connected ? '已配置' : '未配置'} 
                      color={healthStatus.ai_service.connected ? 'success' : 'warning'}
                      size="small"
                      sx={{ mb: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      服务: {healthStatus.ai_service.service_name}
                    </Typography>
                    {healthStatus.ai_service.model && (
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        模型: {healthStatus.ai_service.model}
                      </Typography>
                    )}
                    {!healthStatus.ai_service.connected && healthStatus.ai_service.error && (
                      <Typography variant="caption" color="warning.main">
                        {healthStatus.ai_service.error}
                      </Typography>
                    )}
                    <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 1 }}>
                      点击配置 →
                    </Typography>
                  </CardContent>
                </Card>
              )}

              {/* 日志统计 */}
              {logStats && (
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <SecurityIcon sx={{ mr: 1 }} />
                      <Typography variant="h6">操作日志</Typography>
                    </Box>
                    <Typography variant="h4" color="primary" gutterBottom>
                      {logStats.total_logs?.toLocaleString() ?? 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      成功率: {((logStats.success_rate ?? 0) * 100).toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      成功: {logStats.success_count ?? 0} / 失败: {logStats.failed_count ?? 0}
                    </Typography>
                  </CardContent>
                </Card>
              )}
            </Box>

            {/* 系统资源趋势图表 */}
            {metricsHistory.length > 0 && (
              <SystemResourceChart data={metricsHistory} />
            )}

            {/* 日志统计图表 */}
            {logStats && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 3 }}>
                <LogStatsChart 
                  successCount={logStats.success_count}
                  failedCount={logStats.failed_count}
                />
                
                {/* 系统信息卡片 */}
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <SpeedIcon sx={{ mr: 1 }} />
                      <Typography variant="h6">系统信息</Typography>
                    </Box>
                    <Stack spacing={1}>
                      {systemStats && (
                        <Typography variant="body2" color="text.secondary">
                          运行时间: {formatUptime(systemStats.uptime_seconds)}
                        </Typography>
                      )}
                      <Typography variant="body2" color="text.secondary">
                        最后更新: {new Date().toLocaleString()}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        数据点数: {metricsHistory.length} / 20
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              </Box>
            )}
          </Stack>
      </Container>
    </Box>
  );
};

export default DashboardPage;
