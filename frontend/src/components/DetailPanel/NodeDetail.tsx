import { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Chip,
  Divider,
  Paper,
  Skeleton,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Label as LabelIcon,
  Fingerprint as IdIcon,
} from '@mui/icons-material';
import { getNodeLabel } from '../../utils/colorMapping';
import { NodeLabelMenu } from './NodeLabelMenu';
import { NodeTypeStyleConfig } from './NodeTypeStyleConfig';
import { useGraphStore } from '../../store/graphStore';
import type { NodeDetailResponse } from '../../types/api';

interface NodeDetailProps {
  nodeDetail: NodeDetailResponse | null;
  isLoading: boolean;
  error: string | null;
}

export function NodeDetail({ nodeDetail, isLoading, error }: NodeDetailProps) {
  const [styleConfigOpen, setStyleConfigOpen] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<string>('');
  const { graphData, nodeTypeStyles, setNodeTypeStyle } = useGraphStore();

  // 分析当前节点类型的可用属性
  const availableProperties = useMemo(() => {
    if (!nodeDetail || !graphData) {
      return {};
    }

    const currentNodeType = nodeDetail.labels[0] || 'Unknown';
    const properties: Record<string, Set<string>> = {};
    properties[currentNodeType] = new Set();

    // 分析同类型节点的所有属性
    graphData.nodes
      .filter(node => node.labels[0] === currentNodeType)
      .forEach(node => {
        Object.keys(node.properties).forEach(prop => {
          properties[currentNodeType].add(prop);
        });
      });

    const availableProps: Record<string, string[]> = {};
    availableProps[currentNodeType] = Array.from(properties[currentNodeType]).sort();

    return availableProps;
  }, [nodeDetail, graphData]);



  const handleStyleConfigChange = (style: any) => {
    if (selectedNodeType) {
      console.log('🎨 NodeDetail - Applying style config for:', selectedNodeType, style);
      setNodeTypeStyle(selectedNodeType, style);
      console.log('🎨 NodeDetail - Style config saved to store');
    }
  };

  // 获取指定节点类型的样式配置
  const getNodeTypeStyle = (nodeType: string) => {
    return nodeTypeStyles[nodeType] || {
      color: '#1976d2',
      size: 60,
      borderWidth: 2,
      showLabels: true,
      labelSize: 12,
      showImages: true,
      caption: ['name'],
    };
  };

  // 处理标签右键点击
  const handleLabelContextMenu = (event: React.MouseEvent, nodeType: string) => {
    event.preventDefault();
    console.log('Right click on label:', nodeType);
    setMenuAnchorEl(event.currentTarget as HTMLElement);
    setSelectedNodeType(nodeType);
  };

  // 处理标签左键点击 - 简化为只设置选中的节点类型
  const handleLabelClick = (nodeType: string) => {
    console.log('👆 Left click on label:', nodeType);
    setSelectedNodeType(nodeType);
  };

  const handleMenuClose = () => {
    console.log('🔒 Menu closed');
    setMenuAnchorEl(null);
  };



  const handleConfigureStyle = () => {
    console.log('🎨 Configure style for:', selectedNodeType);
    setStyleConfigOpen(true);
  };

  const handleToggleVisibility = () => {
    // TODO: 实现节点类型的显示/隐藏功能
    console.log('Toggle visibility for:', selectedNodeType);
  };

  // 加载状态
  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="text" width="60%" height={32} />
        <Skeleton variant="text" width="40%" sx={{ mt: 1 }} />
        <Skeleton variant="rectangular" height={100} sx={{ mt: 2 }} />
        <Skeleton variant="rectangular" height={60} sx={{ mt: 2 }} />
      </Box>
    );
  }

  // 错误状态
  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  // 空状态
  if (!nodeDetail) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'text.secondary',
          p: 4,
        }}
      >
        <Typography variant="body2">选择节点以查看详情</Typography>
      </Box>
    );
  }

  // 获取节点名称
  const nodeName =
    nodeDetail.properties.name ||
    nodeDetail.properties.title ||
    nodeDetail.id;

  return (
    <Box sx={{ p: 2 }}>
      {/* 节点名称 */}
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {nodeName}
      </Typography>

      {/* 节点标签 */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {nodeDetail.labels.map((label) => {
          const nodeTypeStyle = getNodeTypeStyle(label);
          return (
            <Tooltip 
              key={label} 
              title="右键更多选项" 
              placement="top"
            >
              <Chip
                label={getNodeLabel([label])}
                size="small"
                icon={<LabelIcon />}
                onClick={() => handleLabelClick(label)}
                onContextMenu={(e) => handleLabelContextMenu(e, label)}
                sx={{ 
                  cursor: 'pointer',
                  backgroundColor: nodeTypeStyle.color,
                  color: 'white',
                  '&:hover': {
                    opacity: 0.8,
                    transform: 'scale(1.02)',
                  },
                  '& .MuiChip-icon': {
                    color: 'white',
                  },
                  transition: 'all 0.2s ease-in-out',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>



      {/* 节点 ID */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IdIcon fontSize="small" color="action" />
        <Typography variant="caption" color="text.secondary">
          {nodeDetail.id}
        </Typography>
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* 节点属性 */}
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        属性
      </Typography>

      <Paper
        variant="outlined"
        sx={{
          p: 2,
          bgcolor: 'background.default',
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {Object.entries(nodeDetail.properties).map(([key, value]) => {
          // 跳过特殊属性（图片、视频、音频）
          if (['images', 'videos', 'audios'].includes(key)) {
            return null;
          }

          // 跳过已显示的属性
          if (['name', 'title'].includes(key)) {
            return null;
          }

          return (
            <Box key={key} sx={{ mb: 1.5 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={600}
                display="block"
              >
                {key}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {typeof value === 'object'
                  ? JSON.stringify(value, null, 2)
                  : String(value)}
              </Typography>
            </Box>
          );
        })}

        {Object.keys(nodeDetail.properties).filter(
          (key) => !['images', 'videos', 'audios', 'name', 'title'].includes(key)
        ).length === 0 && (
          <Typography variant="body2" color="text.secondary">
            无其他属性
          </Typography>
        )}
      </Paper>

      {/* 标签右键菜单 */}
      <NodeLabelMenu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleMenuClose}
        onConfigureStyle={handleConfigureStyle}
        onToggleVisibility={handleToggleVisibility}
        isVisible={true} // TODO: 实现真实的可见性状态
      />



      {/* 节点类型样式配置对话框 */}
      {selectedNodeType && (
        <NodeTypeStyleConfig
          open={styleConfigOpen}
          onClose={() => setStyleConfigOpen(false)}
          nodeType={selectedNodeType}
          config={getNodeTypeStyle(selectedNodeType)}
          availableProperties={availableProperties[selectedNodeType] || []}
          onConfigChange={handleStyleConfigChange}
        />
      )}
    </Box>
  );
}
