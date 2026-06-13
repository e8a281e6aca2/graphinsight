import { Box, Chip, Divider, Typography, Button } from '@mui/material';
import {
  Description as DescriptionIcon,
  LocalLibrary as LibraryIcon,
  DeleteOutline as DeleteOutlineIcon,
  DeleteSweep as DeleteSweepIcon,
  RestoreFromTrash as RestoreFromTrashIcon,
} from '@mui/icons-material';
import { useGraphStore } from '../../store/graphStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listDocuments,
  uploadDocuments,
  deleteDocument,
  clearDocuments,
  listDeletedDocuments,
  restoreDocument,
  type DocumentItem,
  type DeletedDocumentItem,
  type DocumentVerificationSnapshot,
} from '../../services/documents';
import { getErrorMessage } from '../../utils/errorMessage';

function buildGraphSummary(graph?: { documents: number; chunks: number; relations: number; orphan_entities: number }) {
  if (!graph) return '';
  return `图谱清理：文档 ${graph.documents} · 片段 ${graph.chunks} · 关系 ${graph.relations}`;
}

function buildVerificationSummary(verification?: DocumentVerificationSnapshot) {
  if (!verification?.after) return '';
  const graph = verification.after.graph;
  if (!graph) {
    return `校验：文档剩余 ${verification.after.active_documents}`;
  }
  return `校验：文档剩余 ${verification.after.active_documents} · 图文档 ${graph.documents ?? 0} · 图关系 ${graph.relations ?? 0}`;
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

export function DocumentPanel() {
  const selectedCitation = useGraphStore((state) => state.selectedCitation);
  const setSelectedCitation = useGraphStore((state) => state.setSelectedCitation);
  const setGraphData = useGraphStore((state) => state.setGraphData);
  const setRecentUploadedDocIds = useGraphStore((state) => state.setRecentUploadedDocIds);
  const citationRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [deletedDocuments, setDeletedDocuments] = useState<DeletedDocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);

  useEffect(() => {
    if (selectedCitation && citationRef.current) {
      citationRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedCitation]);

  const refreshDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, deletedItems] = await Promise.all([
        listDocuments(),
        listDeletedDocuments(),
      ]);
      setDocuments(items);
      setDeletedDocuments(deletedItems);
      setDocumentsLoaded(true);
    } catch (err) {
      setDocuments([]);
      setDeletedDocuments([]);
      setDocumentsLoaded(false);
      setError(getErrorMessage(err, '文档列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      setUploadSummary(null);
      try {
        const result = await uploadDocuments(files);
        const uploaded = result?.uploaded?.length || 0;
        const skipped = result?.skipped?.length || 0;
        setRecentUploadedDocIds(
          (result?.uploaded || [])
            .map((item) => item.doc_id || item.id)
            .filter((item): item is string => Boolean(item))
        );
        setUploadSummary(`上传成功 ${uploaded} · 跳过 ${skipped}`);
        await refreshDocuments();
      } catch (err) {
        setError(getErrorMessage(err, '文档上传失败'));
      } finally {
        setUploading(false);
      }
    },
    [refreshDocuments, setRecentUploadedDocIds]
  );

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    handleUpload(files);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    handleUpload(files);
    event.target.value = '';
  };

  const handleDeleteOne = useCallback(
    async (item: DocumentItem) => {
      setDeletingId(item.id);
      setError(null);
      try {
        const preview = await deleteDocument(item.id, {
          purgeGraph: true,
          softDelete: true,
          dryRun: true,
          verifyAfter: false,
        });
        const previewText = preview.candidate_file?.exists
          ? `将软删除文档「${item.name}」并清理图谱。`
          : `文件不存在，将仅清理图谱数据。`;
        const graphText = buildGraphSummary(preview.graph);
        const confirmed = window.confirm([previewText, graphText].filter(Boolean).join('\n'));
        if (!confirmed) return;

        const result = await deleteDocument(item.id, {
          purgeGraph: true,
          softDelete: true,
          dryRun: false,
          verifyAfter: true,
        });
        const graphSummary = buildGraphSummary(result?.graph);
        const verificationSummary = buildVerificationSummary(result?.verification);
        setUploadSummary(
          [result?.file_action === 'soft_deleted' ? `已移入回收站 ${item.name}` : `已删除 ${item.name}`, graphSummary, verificationSummary]
            .filter(Boolean)
            .join('。')
        );
        if (selectedCitation?.title === item.name) {
          setSelectedCitation(null);
        }
        await refreshDocuments();
      } catch (err) {
        setError(getErrorMessage(err, '文档删除失败'));
      } finally {
        setDeletingId(null);
      }
    },
    [refreshDocuments, selectedCitation?.title, setSelectedCitation]
  );

  const handleClearAll = useCallback(async () => {
    setClearingAll(true);
    setError(null);
    try {
      const preview = await clearDocuments({
        purgeGraph: true,
        softDelete: true,
        dryRun: true,
        verifyAfter: false,
      });
      const confirmed = window.confirm(
        `即将软删除 ${preview?.candidate_files || 0} 个文档并清理图谱，删除内容可在回收站恢复。\n确认继续？`
      );
      if (!confirmed) return;

      const result = await clearDocuments({
        purgeGraph: true,
        softDelete: true,
        dryRun: false,
        verifyAfter: true,
      });
      const graphSummary = buildGraphSummary(result?.graph);
      const verificationSummary = buildVerificationSummary(result?.verification);
      setUploadSummary(
        [`已处理 ${result?.removed_files || 0} 个文件（软删除）`, graphSummary, verificationSummary]
          .filter(Boolean)
          .join('。')
      );
      setSelectedCitation(null);
      setGraphData({
        nodes: [],
        edges: [],
        stats: { nodeCount: 0, edgeCount: 0, executionTime: 0 },
      });
      await refreshDocuments();
    } catch (err) {
      setError(getErrorMessage(err, '清空知识库失败'));
    } finally {
      setClearingAll(false);
    }
  }, [refreshDocuments, setGraphData, setSelectedCitation]);

  const handleRestore = useCallback(
    async (item: DeletedDocumentItem) => {
      const confirmed = window.confirm(`确认恢复文档「${item.name}」？恢复后可重新建图。`);
      if (!confirmed) return;
      setRestoringId(item.doc_id);
      setError(null);
      try {
        const result = await restoreDocument(item.doc_id);
        const verificationSummary = buildVerificationSummary(result?.verification);
        setUploadSummary(
          [`已恢复 ${result.restored_name}`, verificationSummary, result.note]
            .filter(Boolean)
            .join('。')
        );
        await refreshDocuments();
      } catch (err) {
        setError(getErrorMessage(err, '文档恢复失败'));
      } finally {
        setRestoringId(null);
      }
    },
    [refreshDocuments]
  );

  return (
    <Box
      sx={(theme) => ({
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
        bgcolor: theme.palette.background.default,
        backgroundImage:
          theme.palette.mode === 'dark'
            ? 'radial-gradient(circle at top left, rgba(59, 130, 246, 0.08), transparent 55%), radial-gradient(circle at 80% 20%, rgba(16, 185, 129, 0.08), transparent 50%)'
            : 'radial-gradient(circle at top left, rgba(14, 165, 233, 0.08), transparent 55%), radial-gradient(circle at 80% 20%, rgba(34, 197, 94, 0.08), transparent 50%)',
      })}
    >
      <Box sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
          文档库
        </Typography>
        <Typography variant="body2" color="text.secondary">
          支持上传文档解析，引用会直接定位到具体片段。
        </Typography>
      </Box>

      <Divider />

      <Box sx={{ px: 3, py: 2, overflowY: 'auto', overflowX: 'hidden', flex: 1, minWidth: 0 }}>
        <Box
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
          sx={(theme) => ({
            mb: 2.5,
            p: 2,
            borderRadius: 2,
            border: `1px dashed ${theme.palette.divider}`,
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(15, 23, 42, 0.45)' : 'rgba(248, 250, 252, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          })}
        >
          <Box sx={{ minWidth: 0, flex: '1 1 320px' }}>
            <Typography variant="subtitle2">拖拽上传文档</Typography>
            <Typography variant="caption" color="text.secondary">
              支持 pdf / docx / txt / md / csv / json
            </Typography>
            {uploadSummary && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {uploadSummary}
              </Typography>
            )}
            {error && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                {error}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              size="small"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '上传中...' : '选择文件'}
            </Button>
            <Button
              variant="text"
              color="error"
              size="small"
              startIcon={<DeleteSweepIcon fontSize="small" />}
              disabled={clearingAll}
              onClick={handleClearAll}
            >
              {clearingAll ? '清空中...' : '清空知识库'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFileSelect}
            />
          </Box>
        </Box>

        {selectedCitation && (
          <Box
            ref={citationRef}
            sx={(theme) => ({
              mb: 2.5,
              p: 2,
              borderRadius: 2,
              border: `1px solid ${theme.palette.primary.main}`,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(14, 165, 233, 0.08)',
              boxShadow: theme.shadows[1],
            })}
          >
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              引用片段
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {selectedCitation.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {selectedCitation.snippet}
            </Typography>
            {selectedCitation.location && (
              <Chip
                size="small"
                label={selectedCitation.location}
                sx={{ mt: 1 }}
                variant="outlined"
              />
            )}
          </Box>
        )}

        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {loading && (
            <Typography variant="body2" color="text.secondary">
              正在加载文档...
            </Typography>
          )}
          {!loading && documentsLoaded && documents.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              暂无文档，请先上传。
            </Typography>
          )}
          {!loading && documents.map((item) => {
            const isActive = selectedCitation?.title === item.name;
            const sizeKb = Math.max(1, Math.round(item.size / 1024));
            return (
            <Box
              key={item.id}
              sx={(theme) => ({
                p: 2,
                borderRadius: 2,
                border: `1px solid ${isActive ? theme.palette.primary.main : theme.palette.divider}`,
                bgcolor: isActive
                  ? theme.palette.mode === 'dark'
                    ? 'rgba(59, 130, 246, 0.12)'
                    : 'rgba(14, 165, 233, 0.08)'
                  : theme.palette.background.paper,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                minWidth: 0,
              })}
            >
              <Box
                sx={(theme) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 1.5,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(148, 163, 184, 0.18)' : 'rgba(148, 163, 184, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <DescriptionIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={item.name}
                >
                  {item.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.ext.toUpperCase().replace('.', '')} · {sizeKb} KB
                </Typography>
              </Box>
              <Chip
                icon={<LibraryIcon />}
                label="已入库"
                size="small"
                color="success"
                variant="outlined"
              />
              <Button
                size="small"
                color="error"
                variant="text"
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                disabled={deletingId === item.id}
                onClick={() => {
                  handleDeleteOne(item);
                }}
              >
                {deletingId === item.id ? '删除中...' : '删除'}
              </Button>
            </Box>
            );
          })}
        </Box>

        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            回收站（{deletedDocuments.length}）
          </Typography>
          <Box sx={{ display: 'grid', gap: 1.2 }}>
            {deletedDocuments.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                暂无可恢复文档。
              </Typography>
            )}
            {deletedDocuments.map((item) => {
              const sizeKb = Math.max(1, Math.round(item.size / 1024));
              return (
                <Box
                  key={item.doc_id}
                  sx={(theme) => ({
                    p: 1.5,
                    borderRadius: 2,
                    border: `1px solid ${theme.palette.divider}`,
                    bgcolor: theme.palette.mode === 'dark' ? 'rgba(148, 163, 184, 0.08)' : 'rgba(148, 163, 184, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    minWidth: 0,
                  })}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.name}
                    >
                      {item.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {item.ext.toUpperCase().replace('.', '')} · {sizeKb} KB · 剩余 {formatRemainingTime(item.remaining_ms)}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RestoreFromTrashIcon fontSize="small" />}
                    disabled={restoringId === item.doc_id}
                    onClick={() => {
                      handleRestore(item);
                    }}
                  >
                    {restoringId === item.doc_id ? '恢复中...' : '恢复'}
                  </Button>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
