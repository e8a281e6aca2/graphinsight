import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  AutoGraph,
  DeleteOutline,
  DeleteSweep,
  Description,
  RestoreFromTrash,
  Shield,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/Admin/AdminLayout';
import AdminLoadingButton from '../../components/Admin/AdminLoadingButton';
import AdminRefreshButton from '../../components/Admin/AdminRefreshButton';
import { LoadingState } from '../../components/Loading/AppleSpinner';
import {
  clearDocuments,
  deleteDocument,
  listDeletedDocuments,
  listDocuments,
  restoreDocument,
  type DeletedDocumentItem,
  type DocumentItem,
  type DocumentVerificationSnapshot,
} from '../../services/documents';
import { getErrorMessage } from '../../utils/errorMessage';
import { jobsApi } from '../../services/adminService';

const CLEAR_CONFIRM_TEXT = 'CLEAR';

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: number) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
}

function formatRemainingTime(remainingMs?: number | null) {
  if (!remainingMs || remainingMs <= 0) return '即将过期';
  const totalMinutes = Math.max(1, Math.floor(remainingMs / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

function buildGraphSummary(graph?: { documents: number; chunks: number; relations: number; orphan_entities: number }) {
  if (!graph) return '';
  return `图谱清理：文档 ${graph.documents}，片段 ${graph.chunks}，关系 ${graph.relations}`;
}

function buildVerificationSummary(verification?: DocumentVerificationSnapshot) {
  if (!verification?.after) return '';
  const graph = verification.after.graph;
  if (!graph) {
    return `校验：当前文档 ${verification.after.active_documents}，回收站 ${verification.after.deleted_documents}`;
  }
  return `校验：当前文档 ${verification.after.active_documents}，图文档 ${graph.documents ?? 0}，图关系 ${graph.relations ?? 0}`;
}

const KnowledgeBasePage: React.FC = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [deletedDocuments, setDeletedDocuments] = useState<DeletedDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [creatingBuildGraphJob, setCreatingBuildGraphJob] = useState(false);
  const [latestBuildGraphJobId, setLatestBuildGraphJobId] = useState<number | null>(null);
  const [clearPreview, setClearPreview] = useState<{
    candidate_files?: number;
    candidate_names_preview?: string[];
    graph?: { documents: number; chunks: number; relations: number; orphan_entities: number };
  } | null>(null);

  const totalSize = useMemo(
    () => documents.reduce((sum, item) => sum + Number(item.size || 0), 0),
    [documents]
  );

  const loadData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const [activeItems, deletedItems] = await Promise.all([
        listDocuments(),
        listDeletedDocuments(),
      ]);
      setDocuments(activeItems);
      setDeletedDocuments(deletedItems);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '知识库数据加载失败'));
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDeleteOne = async (item: DocumentItem) => {
    setDeletingId(item.id);
    setError('');
    setMessage('');
    try {
      const preview = await deleteDocument(item.id, {
        purgeGraph: true,
        softDelete: true,
        dryRun: true,
        verifyAfter: false,
      });
      const confirmed = window.confirm(
        [`确认软删除「${item.name}」？`, buildGraphSummary(preview.graph), '删除后可在回收站恢复。']
          .filter(Boolean)
          .join('\n')
      );
      if (!confirmed) return;
      const result = await deleteDocument(item.id, {
        purgeGraph: true,
        softDelete: true,
        dryRun: false,
        verifyAfter: true,
      });
      setMessage(
        [`已移入回收站：${item.name}`, buildGraphSummary(result.graph), buildVerificationSummary(result.verification)]
          .filter(Boolean)
          .join('。')
      );
      await loadData(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '文档删除失败'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestore = async (item: DeletedDocumentItem) => {
    const confirmed = window.confirm(`确认恢复文档「${item.name}」？恢复后需要重新建图。`);
    if (!confirmed) return;
    setRestoringId(item.doc_id);
    setError('');
    setMessage('');
    try {
      const result = await restoreDocument(item.doc_id);
      setMessage(
        [`已恢复：${result.restored_name}`, buildVerificationSummary(result.verification), result.note]
          .filter(Boolean)
          .join('。')
      );
      await loadData(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '文档恢复失败'));
    } finally {
      setRestoringId(null);
    }
  };

  const openClearDialog = async () => {
    setClearOpen(true);
    setClearConfirmText('');
    setClearPreview(null);
    setError('');
    try {
      const preview = await clearDocuments({
        purgeGraph: true,
        softDelete: true,
        dryRun: true,
        verifyAfter: false,
      });
      setClearPreview(preview);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '清空预览失败'));
    }
  };

  const handleClearAll = async () => {
    setClearing(true);
    setError('');
    setMessage('');
    try {
      const result = await clearDocuments({
        purgeGraph: true,
        softDelete: true,
        dryRun: false,
        verifyAfter: true,
      });
      setMessage(
        [`已软删除 ${result.removed_files || 0} 个文档`, buildGraphSummary(result.graph), buildVerificationSummary(result.verification)]
          .filter(Boolean)
          .join('。')
      );
      setClearOpen(false);
      setClearConfirmText('');
      setClearPreview(null);
      await loadData(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '清空知识库失败'));
    } finally {
      setClearing(false);
    }
  };

  const handleCreateBuildGraphJob = async () => {
    setCreatingBuildGraphJob(true);
    setError('');
    setMessage('');
    try {
      const job = await jobsApi.createBuildGraph({
        payload: { source: 'admin_knowledge_base_page', force: false },
        max_retries: 3,
      });
      setLatestBuildGraphJobId(job.id);
      setMessage(`建图任务 #${job.id} 已创建，可在任务中心查看进度。`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '创建建图任务失败'));
    } finally {
      setCreatingBuildGraphJob(false);
    }
  };

  const actionBar = (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <AdminLoadingButton
        variant="contained"
        startIcon={<AutoGraph />}
        loading={creatingBuildGraphJob}
        onClick={handleCreateBuildGraphJob}
        disabled={creatingBuildGraphJob || documents.length === 0}
        label="新建建图任务"
        loadingLabel="创建中..."
      />
      <Button variant="outlined" onClick={() => navigate('/admin/jobs?job_type=build_graph')}>
        查看任务进度
      </Button>
      <AdminRefreshButton onClick={() => void loadData()} loading={loading} />
    </Stack>
  );

  return (
    <AdminLayout title="知识库治理" subtitle="全局文档资产、回收站与高风险清理操作" actions={actionBar}>
      <Container maxWidth="lg" sx={{ px: 0 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {message && (
          <Alert
            severity="success"
            sx={{ mb: 3 }}
            onClose={() => setMessage('')}
            action={
              latestBuildGraphJobId ? (
                <Button color="inherit" size="small" onClick={() => navigate('/admin/jobs?job_type=build_graph')}>
                  去任务中心
                </Button>
              ) : undefined
            }
          >
            {message}
          </Alert>
        )}

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'stretch', lg: 'center' }} justifyContent="space-between">
              <Box>
                <Typography variant="h6">治理边界</Typography>
                <Typography variant="body2" color="text.secondary">
                  工作台负责上传、问答、引用定位和轻量删除；后台负责全量列表、恢复、批量清理、任务追踪和审计。
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Chip icon={<Shield />} color="primary" variant="outlined" label="高风险操作集中管理" />
                <Chip icon={<AutoGraph />} color="success" variant="outlined" label="恢复后需重新建图" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">当前文档</Typography>
              <Typography variant="h4">{documents.length}</Typography>
              <Typography variant="caption" color="text.secondary">可参与问答和建图</Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">回收站</Typography>
              <Typography variant="h4">{deletedDocuments.length}</Typography>
              <Typography variant="caption" color="text.secondary">保留期内可恢复</Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">文档体积</Typography>
              <Typography variant="h4">{formatFileSize(totalSize)}</Typography>
              <Typography variant="caption" color="text.secondary">当前文档总量</Typography>
            </CardContent>
          </Card>
        </Stack>

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box>
              <Typography variant="h6">当前文档</Typography>
              <Typography variant="body2" color="text.secondary">
                查看所有当前文档。单个文档可软删除并进入回收站；批量清理统一走页面底部的危险操作。
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            {loading ? (
              <LoadingState label="正在加载知识库" minHeight={260} />
            ) : documents.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                当前没有入库文档。
              </Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>文档</TableCell>
                      <TableCell>类型</TableCell>
                      <TableCell>大小</TableCell>
                      <TableCell>更新时间</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {documents.map((item) => (
                      <TableRow key={item.id} hover>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
                            <Description fontSize="small" color="primary" />
                            <Typography variant="body2" title={item.name} noWrap sx={{ maxWidth: 420 }}>
                              {item.name}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" variant="outlined" label={item.ext.replace('.', '').toUpperCase() || '-'} />
                        </TableCell>
                        <TableCell>{formatFileSize(item.size)}</TableCell>
                        <TableCell>{formatDate(item.updated_at)}</TableCell>
                        <TableCell align="right">
                          <AdminLoadingButton
                            size="small"
                            color="error"
                            variant="text"
                            startIcon={<DeleteOutline fontSize="small" />}
                            loading={deletingId === item.id}
                            disabled={deletingId === item.id}
                            onClick={() => void handleDeleteOne(item)}
                            label="软删除"
                            loadingLabel="删除中..."
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6">回收站</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              软删除文档在保留期内可恢复。恢复后需要重新建图才能重新参与图谱问答。
            </Typography>

            {loading ? (
              <LoadingState label="正在加载回收站" minHeight={220} />
            ) : deletedDocuments.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                回收站为空。
              </Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>文档</TableCell>
                      <TableCell>大小</TableCell>
                      <TableCell>删除时间</TableCell>
                      <TableCell>剩余保留期</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deletedDocuments.map((item) => (
                      <TableRow key={`${item.doc_id}-${item.deleted_at}`} hover>
                        <TableCell>
                          <Typography variant="body2" title={item.name} noWrap sx={{ maxWidth: 480 }}>
                            {item.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.operator || 'system'}
                          </Typography>
                        </TableCell>
                        <TableCell>{formatFileSize(item.size)}</TableCell>
                        <TableCell>{formatDate(item.deleted_at)}</TableCell>
                        <TableCell>{formatRemainingTime(item.remaining_ms)}</TableCell>
                        <TableCell align="right">
                          <AdminLoadingButton
                            size="small"
                            variant="outlined"
                            startIcon={<RestoreFromTrash fontSize="small" />}
                            loading={restoringId === item.doc_id}
                            disabled={restoringId === item.doc_id}
                            onClick={() => void handleRestore(item)}
                            label="恢复"
                            loadingLabel="恢复中..."
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
              <Box>
                <Typography variant="h6" color="error">危险操作</Typography>
                <Typography variant="body2" color="text.secondary">
                  清空知识库会软删除当前文档并清理文档图谱。适合管理员做环境重置、测试数据清理或重大版本重建前处理。
                </Typography>
              </Box>
              <AdminLoadingButton
                color="error"
                variant="contained"
                startIcon={<DeleteSweep />}
                loading={clearing}
                disabled={documents.length === 0 || clearing}
                onClick={openClearDialog}
                label="清空知识库"
                loadingLabel="处理中..."
              />
            </Stack>
          </CardContent>
        </Card>
      </Container>

      <Dialog open={clearOpen} onClose={() => !clearing && setClearOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认清空知识库</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              该操作会软删除当前文档并清理文档图谱。文件可从回收站恢复，但图谱需要重新构建。
            </Alert>
            <Box>
              <Typography variant="body2" color="text.secondary">
                预览文档数
              </Typography>
              <Typography variant="h6">{clearPreview?.candidate_files ?? documents.length}</Typography>
            </Box>
            {clearPreview?.candidate_names_preview && clearPreview.candidate_names_preview.length > 0 && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  示例文档
                </Typography>
                <Stack spacing={0.5}>
                  {clearPreview.candidate_names_preview.slice(0, 6).map((name) => (
                    <Typography key={name} variant="body2" noWrap>
                      {name}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
            <TextField
              label={`输入 ${CLEAR_CONFIRM_TEXT} 确认`}
              value={clearConfirmText}
              onChange={(event) => setClearConfirmText(event.target.value)}
              fullWidth
              disabled={clearing}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" disabled={clearing} onClick={() => setClearOpen(false)}>
            取消
          </Button>
          <AdminLoadingButton
            variant="contained"
            color="error"
            loading={clearing}
            disabled={clearConfirmText !== CLEAR_CONFIRM_TEXT || clearing}
            onClick={() => void handleClearAll()}
            label="确认清空"
            loadingLabel="清空中..."
          />
        </DialogActions>
      </Dialog>
    </AdminLayout>
  );
};

export default KnowledgeBasePage;
