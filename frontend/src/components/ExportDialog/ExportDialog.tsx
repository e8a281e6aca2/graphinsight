import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Select,
  MenuItem,
  Box,
  Typography,
  Divider,
  Alert,
} from '@mui/material';
import {
  Image as ImageIcon,
  DataObject as JsonIcon,
  Code as SvgIcon,
} from '@mui/icons-material';
import { useGraphStore } from '../../store/graphStore';
import type { RendererAPI } from '../../renderers/core/types';
import { getErrorMessage } from '../../utils/errorMessage';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  rendererRef: React.RefObject<RendererAPI | null>;
}

type ExportFormat = 'png' | 'svg' | 'json';
type PngResolution = 1 | 2 | 4;

export function ExportDialog({ open, onClose, rendererRef }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [resolution, setResolution] = useState<PngResolution>(2);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graphData = useGraphStore((state) => state.graphData);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);

    try {
      if (format === 'png') {
        await exportPNG();
      } else if (format === 'svg') {
        await exportSVG();
      } else if (format === 'json') {
        await exportJSON();
      }
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, '导出失败'));
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportPNG = async () => {
    if (!rendererRef.current) {
      throw new Error('图谱未初始化');
    }

    const png = await rendererRef.current.exportPNG({ background: '#ffffff', scale: resolution });
    const url = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = url;
    link.download = `graph-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportSVG = async () => {
    if (!rendererRef.current) {
      throw new Error('图谱未初始化');
    }

    const svgContent = await rendererRef.current.exportSVG({ background: '#ffffff' });
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `graph-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = async () => {
    if (!graphData) {
      throw new Error('无图数据可导出');
    }

    const data = {
      metadata: {
        exportDate: new Date().toISOString(),
        nodeCount: graphData.nodes.length,
        edgeCount: graphData.edges.length,
      },
      nodes: graphData.nodes,
      edges: graphData.edges,
      stats: graphData.stats,
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `graph-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>导出图谱</DialogTitle>

      <DialogContent>
        <FormControl component="fieldset" fullWidth sx={{ mb: 3 }}>
          <FormLabel component="legend">导出格式</FormLabel>
          <RadioGroup
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <FormControlLabel
              value="png"
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ImageIcon fontSize="small" />
                  <Box>
                    <Typography variant="body2">PNG 图片</Typography>
                    <Typography variant="caption" color="text.secondary">
                      适合插入文档和演示
                    </Typography>
                  </Box>
                </Box>
              }
            />
            <FormControlLabel
              value="svg"
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SvgIcon fontSize="small" />
                  <Box>
                    <Typography variant="body2">SVG 矢量图</Typography>
                    <Typography variant="caption" color="text.secondary">
                      可缩放矢量图形，适合编辑
                    </Typography>
                  </Box>
                </Box>
              }
            />
            <FormControlLabel
              value="json"
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <JsonIcon fontSize="small" />
                  <Box>
                    <Typography variant="body2">JSON 数据</Typography>
                    <Typography variant="caption" color="text.secondary">
                      包含完整的节点和边数据
                    </Typography>
                  </Box>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        <Divider sx={{ my: 2 }} />

        {format === 'png' && (
          <FormControl fullWidth>
            <FormLabel>分辨率</FormLabel>
            <Select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as PngResolution)}
              size="small"
              sx={{ mt: 1 }}
            >
              <MenuItem value={1}>1x (标准)</MenuItem>
              <MenuItem value={2}>2x (高清)</MenuItem>
              <MenuItem value={4}>4x (超清)</MenuItem>
            </Select>
          </FormControl>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isExporting}>
          取消
        </Button>
        <Button variant="contained" onClick={handleExport} disabled={isExporting}>
          {isExporting ? '导出中...' : '导出'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
