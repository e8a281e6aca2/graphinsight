/**
 * 问答链路追踪页面
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Drawer,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Refresh, Search } from '@mui/icons-material';
import AdminLayout from '../../components/Admin/AdminLayout';
import { qaTracesApi } from '../../services/adminService';
import type { QACostSummary, QATraceDetail, QATraceItem, QATraceStatus, QATraceType } from '../../types/admin';
import { getErrorMessage } from '../../utils/errorMessage';

type QATraceTypeFilter = QATraceType | '';
type QATraceStatusFilter = QATraceStatus | '';

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN');
};

const qaTypeLabel = (value: string) => (value === 'deep_research' ? '深度调研' : '文档问答');

const formatPercent = (value: number) => `${(Number(value || 0) * 100).toFixed(1)}%`;

const formatCost = (value: number, currency: string) => `${currency || 'USD'} ${Number(value || 0).toFixed(6)}`;

const QATracesPage: React.FC = () => {
  const [items, setItems] = useState<QATraceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [qaType, setQaType] = useState<QATraceTypeFilter>('');
  const [status, setStatus] = useState<QATraceStatusFilter>('');
  const [keyword, setKeyword] = useState('');
  const [traceId, setTraceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<QATraceDetail | null>(null);
  const [costSummary, setCostSummary] = useState<QACostSummary | null>(null);

  const loadTraces = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await qaTracesApi.getTraces({
        page: page + 1,
        page_size: rowsPerPage,
        qa_type: qaType || undefined,
        status: status || undefined,
        keyword: keyword.trim() || undefined,
        trace_id: traceId.trim() || undefined,
      });
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
      const costData = await qaTracesApi.getCostSummary({
        qa_type: qaType || undefined,
        status: status || undefined,
        window_hours: 24,
      });
      setCostSummary(costData);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '问答追踪加载失败'));
    } finally {
      setLoading(false);
    }
  }, [keyword, page, qaType, rowsPerPage, status, traceId]);

  useEffect(() => {
    void loadTraces();
  }, [loadTraces]);

  const openDetail = async (item: QATraceItem) => {
    setError('');
    try {
      const data = await qaTracesApi.getTrace(item.id);
      setDetail(data);
      setDetailOpen(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '追踪详情加载失败'));
    }
  };

  const actionBar = (
    <Button variant="outlined" startIcon={<Refresh />} onClick={loadTraces} disabled={loading}>
      刷新
    </Button>
  );

  return (
    <AdminLayout title="问答追踪" subtitle="问题、检索证据、模型响应与引用链路" actions={actionBar}>
      <Container maxWidth="lg" sx={{ px: 0 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {costSummary && (
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">24h 模型成本估算</Typography>
                  <Typography variant="h5">
                    {formatCost(costSummary.estimated_cost, costSummary.currency)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    价格来源: {costSummary.pricing_source}，未配置价格时成本按 0 估算
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">调用</Typography>
                  <Typography variant="h6">{costSummary.total_calls}</Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">Token</Typography>
                  <Typography variant="h6">{costSummary.total_tokens}</Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">成功率</Typography>
                  <Typography variant="h6">{formatPercent(costSummary.success_rate)}</Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">Top 模型</Typography>
                  <Typography variant="body2">
                    {costSummary.models[0]?.model || '-'} · {costSummary.models[0]?.total_tokens || 0} tokens
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField select label="类型" value={qaType} onChange={(e) => setQaType(e.target.value as QATraceTypeFilter)} sx={{ minWidth: 160 }}>
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="docqa">文档问答</MenuItem>
                <MenuItem value="deep_research">深度调研</MenuItem>
              </TextField>
              <TextField select label="状态" value={status} onChange={(e) => setStatus(e.target.value as QATraceStatusFilter)} sx={{ minWidth: 140 }}>
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="failed">失败</MenuItem>
              </TextField>
              <TextField label="trace_id" value={traceId} onChange={(e) => setTraceId(e.target.value)} sx={{ minWidth: 220 }} />
              <TextField label="关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} sx={{ flex: 1 }} />
              <Button variant="contained" startIcon={<Search />} onClick={loadTraces}>
                查询
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>类型</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>问题</TableCell>
                  <TableCell>检索/引用</TableCell>
                  <TableCell>延迟</TableCell>
                  <TableCell>时间</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <CircularProgress size={24} />
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">暂无问答追踪记录</TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id} hover sx={{ cursor: 'pointer' }} onClick={() => openDetail(item)}>
                      <TableCell>{item.id}</TableCell>
                      <TableCell>{qaTypeLabel(item.qa_type)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={item.status === 'success' ? '成功' : '失败'}
                          color={item.status === 'success' ? 'success' : 'error'}
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 360 }}>
                        <Typography variant="body2" noWrap>{item.question}</Typography>
                        {item.trace_id && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {item.trace_id}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{item.retrieval_count} / {item.citation_count}</TableCell>
                      <TableCell>{item.latency_ms ?? 0} ms</TableCell>
                      <TableCell>{formatDate(item.created_at)}</TableCell>
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
            rowsPerPage={rowsPerPage}
            onPageChange={(_, next) => setPage(next)}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
        </Card>

        <Drawer anchor="right" open={detailOpen} onClose={() => setDetailOpen(false)} PaperProps={{ sx: { width: { xs: '100%', md: 620 }, p: 3 } }}>
          {detail && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6">追踪详情 #{detail.id}</Typography>
                <Typography variant="body2" color="text.secondary">{detail.trace_id || '-'}</Typography>
              </Box>
              <Alert severity={detail.status === 'success' ? 'success' : 'error'}>
                {qaTypeLabel(detail.qa_type)} · {detail.status} · {detail.latency_ms ?? 0} ms
              </Alert>
              <Box>
                <Typography variant="subtitle2">问题</Typography>
                <Typography variant="body2">{detail.question}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2">回答摘要</Typography>
                <Typography variant="body2" whiteSpace="pre-wrap">{detail.answer_preview || '-'}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2">检索快照</Typography>
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12, bgcolor: 'rgba(15,31,45,0.04)', p: 2, borderRadius: 1, maxHeight: 260, overflow: 'auto' }}>
                  {JSON.stringify(detail.retrieval_snapshot || {}, null, 2)}
                </Box>
              </Box>
              <Box>
                <Typography variant="subtitle2">模型生成</Typography>
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12, bgcolor: 'rgba(15,31,45,0.04)', p: 2, borderRadius: 1, maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(detail.generation_snapshot || {}, null, 2)}
                </Box>
              </Box>
              <Box>
                <Typography variant="subtitle2">响应快照</Typography>
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12, bgcolor: 'rgba(15,31,45,0.04)', p: 2, borderRadius: 1, maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(detail.response_snapshot || {}, null, 2)}
                </Box>
              </Box>
            </Stack>
          )}
        </Drawer>
      </Container>
    </AdminLayout>
  );
};

export default QATracesPage;
