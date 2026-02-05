import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Paper,
  IconButton,
  Tooltip,
  Typography,
  Fade,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Grain as DensityIcon,
} from '@mui/icons-material';
import type { Core } from 'cytoscape';

interface MinimapProps {
  cyRef: React.RefObject<Core | null>;
  width?: number;
  height?: number;
}

export function Minimap({ cyRef, width = 200, height = 150 }: MinimapProps) {
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapCyRef = useRef<Core | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const [viewportRect, setViewportRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // 初始化小地图
  useEffect(() => {
    if (!minimapRef.current || !cyRef.current || !isVisible) return;

    const mainCy = cyRef.current;
    
    // 创建小地图的Cytoscape实例
    const minimapCy = (window as any).cytoscape({
      container: minimapRef.current,
      elements: mainCy.elements().jsons(),
      style: [
        {
          selector: 'node',
          style: {
            'background-color': showDensity ? (node: any) => {
              const degree = node.degree();
              const maxDegree = 10; // 假设最大度数
              const intensity = Math.min(degree / maxDegree, 1);
              return `hsl(${240 - intensity * 120}, 70%, ${50 + intensity * 30}%)`;
            } : 'data(color)',
            width: showDensity ? (node: any) => Math.max(6, Math.min(16, 6 + node.degree() * 2)) : 8,
            height: showDensity ? (node: any) => Math.max(6, Math.min(16, 6 + node.degree() * 2)) : 8,
            'border-width': 0,
            label: '',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            width: showDensity ? 0.5 : 1,
            'line-color': showDensity ? '#999' : '#ccc',
            'target-arrow-shape': 'none',
            'curve-style': 'straight',
            label: '',
            opacity: showDensity ? 0.6 : 0.8,
          },
        },
        {
          selector: '.highlighted',
          style: {
            'background-color': '#ff4081',
            width: 12,
            height: 12,
            'border-width': 2,
            'border-color': '#fff',
            'z-index': 999,
          },
        },
      ],
      layout: { name: 'preset' },
      zoomingEnabled: false,
      panningEnabled: false,
      boxSelectionEnabled: false,
      selectionType: 'single',
      autoungrabify: true,
      userZoomingEnabled: false,
      userPanningEnabled: false,
    });

    minimapCyRef.current = minimapCy;

    // 适应视口
    minimapCy.fit(undefined, 10);

    // 更新视口矩形
    updateViewportRect();

    // 监听主图的视口变化
    const handleViewportChange = () => {
      updateViewportRect();
    };

    mainCy.on('viewport', handleViewportChange);
    mainCy.on('zoom', handleViewportChange);
    mainCy.on('pan', handleViewportChange);

    // 监听小地图点击
    minimapCy.on('tap', (event: any) => {
      if (event.target === minimapCy) {
        // 点击背景，移动主图视口
        const position = event.position;
        const mainExtent = mainCy.extent();
        const minimapExtent = minimapCy.extent();
        
        // 计算比例
        const scaleX = (mainExtent.x2 - mainExtent.x1) / (minimapExtent.x2 - minimapExtent.x1);
        const scaleY = (mainExtent.y2 - mainExtent.y1) / (minimapExtent.y2 - minimapExtent.y1);
        
        // 转换坐标
        const mainX = (position.x - minimapExtent.x1) * scaleX + mainExtent.x1;
        const mainY = (position.y - minimapExtent.y1) * scaleY + mainExtent.y1;
        
        // 移动主图
        mainCy.animate({
          pan: { x: -mainX * mainCy.zoom() + mainCy.width() / 2, y: -mainY * mainCy.zoom() + mainCy.height() / 2 },
        }, {
          duration: 300,
        });
      }
    });

    // 清理函数
    return () => {
      mainCy.off('viewport', handleViewportChange);
      mainCy.off('zoom', handleViewportChange);
      mainCy.off('pan', handleViewportChange);
      
      if (minimapCyRef.current) {
        minimapCyRef.current.destroy();
        minimapCyRef.current = null;
      }
    };
  }, [cyRef, isVisible]);

  // 更新视口矩形
  const updateViewportRect = () => {
    if (!cyRef.current || !minimapCyRef.current) return;

    const mainCy = cyRef.current;
    const minimapCy = minimapCyRef.current;

    // 获取主图的视口范围
    const mainExtent = mainCy.extent();
    const minimapExtent = minimapCy.extent();

    // 计算视口在小地图中的位置和大小
    const scaleX = (minimapExtent.x2 - minimapExtent.x1) / (mainExtent.x2 - mainExtent.x1);
    const scaleY = (minimapExtent.y2 - minimapExtent.y1) / (mainExtent.y2 - mainExtent.y1);

    const viewportWidth = (mainCy.width() / mainCy.zoom()) * scaleX;
    const viewportHeight = (mainCy.height() / mainCy.zoom()) * scaleY;

    const pan = mainCy.pan();
    const zoom = mainCy.zoom();
    
    const viewportX = ((-pan.x / zoom - mainExtent.x1) * scaleX + minimapExtent.x1);
    const viewportY = ((-pan.y / zoom - mainExtent.y1) * scaleY + minimapExtent.y1);

    setViewportRect({
      x: viewportX,
      y: viewportY,
      width: viewportWidth,
      height: viewportHeight,
    });
  };

  // 高亮节点（暂时未使用，但保留接口）
  // const highlightNode = (nodeId: string | null) => {
  //   if (!minimapCyRef.current) return;
  //   const minimapCy = minimapCyRef.current;
  //   minimapCy.elements().removeClass('highlighted');
  //   if (nodeId) {
  //     const node = minimapCy.getElementById(nodeId);
  //     if (node.length > 0) {
  //       node.addClass('highlighted');
  //     }
  //   }
  // };

  // 同步主图数据变化
  useEffect(() => {
    if (!cyRef.current || !minimapCyRef.current || !isVisible) return;

    const mainCy = cyRef.current;
    const minimapCy = minimapCyRef.current;

    // 同步元素
    try {
      minimapCy.elements().remove();
      const elements = mainCy.elements().jsons();
      if (elements && elements.length > 0) {
        // 确保元素格式正确
        const validElements = elements.filter((el: any) => el && el.data);
        if (validElements.length > 0) {
          minimapCy.add(validElements as any);
        }
      }
    } catch (error) {
      console.warn('Failed to sync minimap elements:', error);
    }
    minimapCy.fit(undefined, 10);
    
    updateViewportRect();
  }, [cyRef.current?.elements().length, isVisible]);

  const displayWidth = isExpanded ? width * 1.5 : width;
  const displayHeight = isExpanded ? height * 1.5 : height;

  return (
    <Fade in={isVisible}>
      <Paper
        elevation={4}
        sx={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          width: displayWidth,
          height: displayHeight + 40, // 额外空间给控制按钮
          zIndex: 1000,
          overflow: 'hidden',
          transition: 'all 0.3s ease',
          // 确保不被其他元素遮挡
          '@media (max-width: 600px)': {
            bottom: 80, // 移动端避免被底部控件遮挡
          },
        }}
      >
        {/* 控制栏 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 0.5,
            backgroundColor: 'background.default',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            小地图
          </Typography>
          
          <Box>
            <Tooltip title={showDensity ? '普通视图' : '密度视图'}>
              <IconButton
                size="small"
                onClick={() => setShowDensity(!showDensity)}
                color={showDensity ? 'primary' : 'default'}
              >
                <DensityIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            
            <Tooltip title={isExpanded ? '缩小' : '放大'}>
              <IconButton
                size="small"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <ZoomOutIcon fontSize="small" /> : <ZoomInIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="隐藏小地图">
              <IconButton
                size="small"
                onClick={() => setIsVisible(false)}
              >
                <VisibilityOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* 小地图容器 */}
        <Box
          sx={{
            position: 'relative',
            width: displayWidth,
            height: displayHeight,
            backgroundColor: 'background.paper',
          }}
        >
          <div
            ref={minimapRef}
            style={{
              width: '100%',
              height: '100%',
              cursor: 'pointer',
            }}
          />

          {/* 视口矩形 */}
          {viewportRect && (
            <Box
              sx={{
                position: 'absolute',
                left: `${(viewportRect.x / (minimapCyRef.current?.width() || 1)) * 100}%`,
                top: `${(viewportRect.y / (minimapCyRef.current?.height() || 1)) * 100}%`,
                width: `${(viewportRect.width / (minimapCyRef.current?.width() || 1)) * 100}%`,
                height: `${(viewportRect.height / (minimapCyRef.current?.height() || 1)) * 100}%`,
                border: 2,
                borderColor: 'primary.main',
                backgroundColor: 'primary.main',
                opacity: 0.2,
                pointerEvents: 'none',
              }}
            />
          )}
        </Box>
      </Paper>
    </Fade>
  );

  // 显示/隐藏切换按钮（当小地图隐藏时）
  if (!isVisible) {
    return (
      <Tooltip title="显示小地图">
        <IconButton
          sx={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 1000,
            backgroundColor: 'background.paper',
            boxShadow: 2,
            '&:hover': {
              backgroundColor: 'background.paper',
            },
          }}
          onClick={() => setIsVisible(true)}
        >
          <VisibilityIcon />
        </IconButton>
      </Tooltip>
    );
  }
}