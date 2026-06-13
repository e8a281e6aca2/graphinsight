/**
 * 操作日志页面 v2.0
 * 使用标准化 API
 */
import React, { useCallback, useEffect, useState } from 'react';
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
  Chip,
  CircularProgress,
  Alert,
  TextField,
  MenuItem,
  Button,
} from '@mui/material';
import { Refresh, FilterList, Download } from '@mui/icons-material';
import { logApi } from '../../services/adminService';
import type { LogItem } from '../../types/admin';
import AdminLayout from '../../components/Admin/AdminLayout';
import { getErrorMessage } from '../../utils/errorMessage';

type LogStatusFilter = 'success' | 'failed' | '';

const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<string>('');
  const [status, setStatus] = useState<LogStatusFilter>('');
  const [traceId, setTraceId] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await logApi.getLogs({
        page: page + 1,
        page_size: rowsPerPage,
        action: action || undefined,
        status: status || undefined,
        trace_id: traceId.trim() || undefined,
      });
      setLogs(Array.isArray(response.logs) ? response.logs : []);
      setTotal(Number(response.total || 0));
    } catch (err: unknown) {
      console.error('加载日志失败:', err);
      setError(getErrorMessage(err, '加载日志失败'));
    } finally {
      setLoading(false);
    }
  }, [action, page, rowsPerPage, status, traceId]);

  const handleExportCsv = async () => {
    try {
      setLoading(true);
      const blob = await logApi.exportLogsCsv({
        action: action || undefined,
        status: status || undefined,
        trace_id: traceId.trim() || undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `admin_logs_${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '导出失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN');
  };

  const actionBar = (
    <Button variant="outlined" startIcon={<Refresh />} onClick={loadLogs} disabled={loading}>
      刷新
    </Button>
  );

  return (
    <AdminLayout title="日志审计" subtitle="关键操作与风险留痕" actions={actionBar}>
      <Container maxWidth="lg" sx={{ px: 0 }}>
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
                  setStatus(e.target.value as LogStatusFilter);
                  setPage(0);
                }}
                sx={{ minWidth: 120 }}
                size="small"
              >
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="failed">失败</MenuItem>
              </TextField>
              <TextField
                label="Trace ID"
                value={traceId}
                onChange={(e) => {
                  setTraceId(e.target.value);
                  setPage(0);
                }}
                size="small"
                sx={{ minWidth: 260 }}
                placeholder="按 trace_id 精确查询"
              />

              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={loadLogs}
                disabled={loading}
              >
                刷新
              </Button>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={handleExportCsv}
                disabled={loading}
              >
                导出 CSV
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
                        <TableCell>Trace ID</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} align="center">
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
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                                {log.trace_id || '-'}
                              </Typography>
                            </TableCell>
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
                  rowsPerPageOptions={[10, 20, 25, 50, 100]}
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
    </AdminLayout>
  );
};

export default LogsPage;
