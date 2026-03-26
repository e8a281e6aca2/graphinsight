import { useState, useEffect } from 'react';
import { Box, Typography, Paper, Chip } from '@mui/material';
import { getNodeLabel } from '../../utils/colorMapping';

interface NodeTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  nodeData: {
    id: string;
    label: string;
    type: string;
    properties: Record<string, any>;
  } | null;
}

export function NodeTooltip({ visible, x, y, nodeData }: NodeTooltipProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible && nodeData) {
      // 延迟 500ms 显示提示框
      const timer = setTimeout(() => {
        setShow(true);
      }, 500);

      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible, nodeData]);

  if (!show || !nodeData) {
    return null;
  }

  // 计算提示框位置（避免超出屏幕）
  const tooltipX = Math.min(x + 10, window.innerWidth - 250);
  const tooltipY = Math.min(y + 10, window.innerHeight - 150);

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        left: tooltipX,
        top: tooltipY,
        zIndex: 9999,
        p: 2,
        minWidth: 200,
        maxWidth: 300,
        pointerEvents: 'none',
      }}
    >
      {/* 节点名称 */}
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {nodeData.label}
      </Typography>

      {/* 节点类型 */}
      <Box sx={{ mb: 1 }}>
        <Chip
          label={getNodeLabel([nodeData.type])}
          size="small"
          color="primary"
          variant="outlined"
        />
      </Box>

      {/* 节点 ID */}
      <Typography variant="caption" color="text.secondary" display="block">
        ID: {nodeData.id}
      </Typography>

      {/* 属性预览 */}
      {nodeData.properties.description && (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{
            mt: 1,
            maxHeight: 60,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {nodeData.properties.description}
        </Typography>
      )}
    </Paper>
  );
}
