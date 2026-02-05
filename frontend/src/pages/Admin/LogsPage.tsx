/**
 * 操作日志页面 v2.0
 * 使用标准化 API
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  AppBar,
  Toolbar,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  MenuItem,
  Button,
} from '@mui/material';
import { ArrowBack, Refresh, FilterList } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { logApi } from '../../services/adminService';
import type { LogItem } from '../../types/admin';

const LogsPage: React.FC = () => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<string>('');
  const [status, setStatus] = useState<'success' | 'failed' | ''>('');

  useEffect(() => {
    loadLogs();
  }, [page, rowsPerPage, action, status]);

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await logApi.getLogs({
        page: page + 1,
        page_size: rowsPerPage,
        action: action || undefined,
        status: status || undefined,
      });
      setLogs(response.logs);
      setTotal(response.total);
    } catch (err: any) {
      console.error('加载日志失败:', err);
      setError(err.message || '加载日志失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN');
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
            操作日志
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <FilterList />
              <TextField
                select
                label="操作类型"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 150 }}
                size="small"
              >
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="login">登录</MenuItem>
                <MenuItem value="logout">登出</MenuItem>
                <MenuItem value="config_update">配置更新</MenuItem>
                <MenuItem value="query">查询</MenuItem>
              </TextField>

              <TextField
                select
                label="状态"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as any);
                  setPage(0);
                }}
                sx={{ minWidth: 120 }}
                size="small"
              >
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="failed">失败</MenuItem>
              </TextField>

              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={loadLogs}
                disabled={loading}
              >
                刷新
              </Button>
            </Box>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            {loading && logs.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>时间</TableCell>
                        <TableCell>用户</TableCell>
                        <TableCell>操作</TableCell>
                        <TableCell>资源</TableCell>
                        <TableCell>状态</TableCell>
                        <TableCell>详情</TableCell>
                        <TableCell>IP 地址</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} align="center">
                            <Typography color="text.secondary">暂无日志</Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        logs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>{formatDate(log.created_at)}</TableCell>
                            <TableCell>{log.username || log.user_id || '-'}</TableCell>
                            <TableCell>
                              <Chip label={log.action} size="small" />
                            </TableCell>
                            <TableCell>{log.resource || '-'}</TableCell>
                            <TableCell>
                              <Chip
                                label={log.status}
                                color={log.status === 'success' ? 'success' : 'error'}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                {log.details || log.error_message || '-'}
                              </Typography>
                            </TableCell>
                            <TableCell>{log.ip_address || '-'}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={total}
                  page={page}
                  onPageChange={(_, newPage) => setPage(newPage)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  labelRowsPerPage="每页行数"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                />
              </>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
};

export default LogsPage;
