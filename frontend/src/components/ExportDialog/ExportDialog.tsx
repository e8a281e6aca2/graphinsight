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
import type { Core } from 'cytoscape';
// @ts-ignore - cytoscape-svg 没有类型定义
import svg from 'cytoscape-svg';
import cytoscape from 'cytoscape';
import { useGraphStore } from '../../store/graphStore';

// 注册 SVG 扩展
if (typeof cytoscape !== 'undefined') {
  cytoscape.use(svg);
}

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  cyRef: React.RefObject<Core | null>;
}

type ExportFormat = 'png' | 'svg' | 'json';
type PngResolution = 1 | 2 | 4;

export function ExportDialog({ open, onClose, cyRef }: ExportDialogProps) {
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
    } catch (err: any) {
      setError(err.message || '导出失败');
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportPNG = async () => {
    if (!cyRef.current) {
      throw new Error('图谱未初始化');
    }

    const cy = cyRef.current;
    
    // 生成 PNG
    const png = cy.png({
      output: 'blob',
      bg: '#ffffff',
      full: true,
      scale: resolution,
    });

    // 下载
    const url = URL.createObjectURL(png as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `graph-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportSVG = async () => {
    if (!cyRef.current) {
      throw new Error('图谱未初始化');
    }

    const cy = cyRef.current;
    
    // 生成 SVG
    const svgContent = (cy as any).svg({
      full: true,
      scale: 1,
    });

    // 创建 Blob 并下载
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

    // 序列化图数据
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
        {/* 格式选择 */}
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

        {/* PNG 选项 */}
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
              <MenuItem value={4}>4x (超高清)</MenuItem>
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              更高的分辨率会生成更大的文件
            </Typography>
          </FormControl>
        )}

        {/* SVG 选项 */}
        {format === 'svg' && (
          <Alert severity="info">
            SVG 是可缩放的矢量图形格式，可以在不失真的情况下放大，并且可以在矢量图形编辑器中进一步编辑。
          </Alert>
        )}

        {/* JSON 选项 */}
        {format === 'json' && (
          <Alert severity="info">
            JSON 文件将包含所有节点、边和属性数据，可用于数据分析或重新导入。
          </Alert>
        )}

        {/* 错误提示 */}
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
        <Button
          onClick={handleExport}
          variant="contained"
          disabled={isExporting || !graphData}
        >
          {isExporting ? '导出中...' : '导出'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
