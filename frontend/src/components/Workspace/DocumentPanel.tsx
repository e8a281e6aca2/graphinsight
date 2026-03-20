import { Box, Chip, Divider, Typography, Button } from '@mui/material';
import { Description as DescriptionIcon, LocalLibrary as LibraryIcon } from '@mui/icons-material';
import { useGraphStore } from '../../store/graphStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listDocuments, uploadDocuments, type DocumentItem } from '../../services/documents';

export function DocumentPanel() {
  const selectedCitation = useGraphStore((state) => state.selectedCitation);
  const citationRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const items = await listDocuments();
      setDocuments(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
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
        setUploadSummary(`上传成功 ${uploaded} · 跳过 ${skipped}`);
        await refreshDocuments();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [refreshDocuments]
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

  return (
    <Box
      sx={(theme) => ({
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
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

      <Box sx={{ px: 3, py: 2, overflow: 'auto', flex: 1 }}>
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
            gap: 2,
          })}
        >
          <Box>
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
          <Box>
            <Button
              variant="contained"
              size="small"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '上传中...' : '选择文件'}
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
          {!loading && documents.length === 0 && (
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
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">{item.name}</Typography>
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
            </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
