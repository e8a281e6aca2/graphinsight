import { useEffect, useRef, useMemo, useState } from 'react';
import { Box, Typography, Dialog, DialogTitle, DialogContent, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { useGraphStore } from '../../store/graphStore';
import { LAYOUT_CONFIGS } from '../../utils/cytoscapeConfig';
import { generateDynamicStylesByNodeType, applyNodeTypeStylesToCytoscape } from '../../utils/dynamicStyleGenerator';
import { convertToCytoscapeFormat } from '../../utils/graphDataConverter';
import { generateVideoThumbnail } from '../../utils/videoThumbnail';
import { GraphControls } from './GraphControls';
import { NodeTooltip } from './NodeTooltip';
import { Minimap } from './Minimap';
import { ContextMenu } from './ContextMenu';
import { PerformanceWarningDialog } from './PerformanceWarningDialog';

interface GraphCanvasProps {
  cyRef?: React.RefObject<Core | null>;
  onGroupingUpdate?: () => void;
}

export function GraphCanvas({ cyRef: externalCyRef, onGroupingUpdate }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalCyRef = useRef<Core | null>(null);
  const cyRef = externalCyRef || internalCyRef;

  // 提示框状态
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [tooltipData, setTooltipData] = useState<any>(null);

  // 视频播放状态
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<{ url: string; title: string } | null>(null);

  // 右键菜单状态
  const [contextMenuPosition, setContextMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<any>(null);

  // 性能警告状态
  const [showPerformanceWarning, setShowPerformanceWarning] = useState(false);
  const [pendingGraphData, setPendingGraphData] = useState<any>(null);
  const [userConfirmedLargeGraph, setUserConfirmedLargeGraph] = useState(false);
  const PERFORMANCE_THRESHOLD = 500;

  const graphData = useGraphStore((state) => state.graphData);
  const isDarkMode = useGraphStore((state) => state.isDarkMode);
  const setSelectedNodeId = useGraphStore((state) => state.setSelectedNodeId);
  const activeFilters = useGraphStore((state) => state.activeFilters);
  const nodeTypeStyles = useGraphStore((state) => state.nodeTypeStyles);
  const groupingState = useGraphStore((state) => state.groupingState);
  const toggleGroupCollapse = useGraphStore((state) => state.toggleGroupCollapse);

  // 展开节点状态
  const [isExpanding, setIsExpanding] = useState(false);

  // 视频播放处理函数
  const handleVideoPlay = (videoUrl: string, title: string) => {
    console.log('🎬 handleVideoPlay called with:', { videoUrl, title });
    setCurrentVideo({ url: videoUrl, title });
    setVideoDialogOpen(true);
    console.log('📺 Video dialog should open now');
  };

  // 展开节点处理函数
  const handleExpandNode = async (nodeId: string) => {
    if (isExpanding) return;
    
    setIsExpanding(true);
    console.log('Expanding node:', nodeId);
    
    try {
      const response = await fetch('http://localhost:8000/api/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: nodeId,
          direction: 'both',
          limit: 20
        }),
      });
      
      const data = await response.json();
      console.log('Expand result:', data);
      
      if (data.nodes && data.nodes.length > 0) {
        // 合并新节点和边到现有图数据
        const currentData = graphData || { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, executionTime: 0 } };
        
        // 去重合并节点
        const existingNodeIds = new Set(currentData.nodes.map(n => n.id));
        const newNodes = data.nodes.filter((n: any) => !existingNodeIds.has(n.id));
        
        // 去重合并边
        const existingEdgeIds = new Set(currentData.edges.map(e => e.id));
        const newEdges = data.edges.filter((e: any) => !existingEdgeIds.has(e.id));
        
        const mergedData = {
          nodes: [...currentData.nodes, ...newNodes],
          edges: [...currentData.edges, ...newEdges],
          stats: {
            nodeCount: currentData.nodes.length + newNodes.length,
            edgeCount: currentData.edges.length + newEdges.length,
            executionTime: data.stats?.executionTime || 0
          }
        };
        
        console.log('📈 Merged data:', mergedData.stats);
        setGraphData(mergedData);
      } else {
        console.log('No new neighbors found for node:', nodeId);
      }
    } catch (error) {
      console.error('Failed to expand node:', error);
    } finally {
      setIsExpanding(false);
    }
  };

  const handleVideoClose = () => {
    setVideoDialogOpen(false);
    setCurrentVideo(null);
  };

  // 性能警告处理函数
  const handlePerformanceContinue = () => {
    console.log('User chose to continue loading large graph');
    setShowPerformanceWarning(false);
    setPendingGraphData(null);
    setUserConfirmedLargeGraph(true); // 标记用户已确认
    // 数据已经在 graphData 中，关闭警告后会触发重新渲染
  };

  const handlePerformanceCancel = () => {
    console.log('User cancelled loading large graph');
    setShowPerformanceWarning(false);
    setPendingGraphData(null);
    setUserConfirmedLargeGraph(false);
    // 清空图数据
    const emptyData = { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, executionTime: 0 } };
    setGraphData(emptyData);
  };

  const setGraphData = useGraphStore((state) => state.setGraphData);

  // 当 graphData 变化时，重置用户确认状态（新查询时）
  useEffect(() => {
    // 如果是新的查询数据（不同的数据），重置确认状态
    if (graphData && graphData.nodes.length > 0) {
      setUserConfirmedLargeGraph(false);
    }
  }, [graphData?.stats?.executionTime]); // 使用 executionTime 作为新查询的标识

  // 转换图数据为 Cytoscape 格式
  const cytoscapeElements = useMemo(() => {
    console.log('GraphCanvas - graphData:', graphData);
    console.log('GraphCanvas - groupingState:', groupingState);
    
    // 检查性能警告（只在用户未确认且没有待处理数据时触发）
    if (graphData && graphData.nodes.length > PERFORMANCE_THRESHOLD && !userConfirmedLargeGraph && !pendingGraphData) {
      console.log('Performance warning triggered:', graphData.nodes.length, 'nodes');
      setPendingGraphData(graphData);
      setShowPerformanceWarning(true);
      return []; // 暂时不渲染，等待用户确认
    }
    
    const elements = convertToCytoscapeFormat(
      graphData, 
      groupingState.groups, 
      groupingState.showGroupLabels,
      nodeTypeStyles
    );
    console.log('GraphCanvas - cytoscapeElements:', elements);
    
    // 异步生成视频缩略图
    elements.forEach((element) => {
      // 只处理节点元素
      if ('source' in element.data) return; // 跳过边元素
      
      const nodeData = element.data as any;
      if (nodeData.isVideo && nodeData.video) {
        generateVideoThumbnail(nodeData.video).then((thumbnailUrl) => {
          // 更新节点图片
          if (cyRef.current) {
            const node = cyRef.current.getElementById(nodeData.id);
            if (node.length > 0) {
              node.data('image', thumbnailUrl);
              console.log('🎬 Updated video thumbnail for node:', nodeData.id);
            }
          }
        }).catch((error) => {
          console.warn('Failed to generate video thumbnail for node:', nodeData.id, error);
        });
      }
    });
    
    return elements;
  }, [graphData, groupingState, nodeTypeStyles, pendingGraphData, userConfirmedLargeGraph]);

  // 初始化 Cytoscape 实例
  useEffect(() => {
    if (!containerRef.current) return;

    // 创建 Cytoscape 实例
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        ...generateDynamicStylesByNodeType(nodeTypeStyles, isDarkMode),
        // 搜索高亮样式
        {
          selector: '.search-highlight',
          style: {
            'border-width': 3,
            'border-color': '#ffd700',
            'border-opacity': 1,
            'background-color': '#ffd700',
            'background-opacity': 0.3,
            'z-index': 999,
          },
        },
      ],
      layout: LAYOUT_CONFIGS.cose,
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      selectionType: 'single',
    });

    console.log('Cytoscape instance created:', cy);
    console.log('Container size:', containerRef.current?.offsetWidth, 'x', containerRef.current?.offsetHeight);

    // 添加事件监听器

    // 单击节点 - 选择节点
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      console.log('👆 Single click node:', node.id(), 'data:', node.data());
      setSelectedNodeId(node.id());
    });

    // 双击节点 - 播放视频、展开节点或切换分组折叠
    cy.on('dbltap', 'node', (event) => {
      const node = event.target;
      const nodeType = node.data('type');
      
      // 如果是分组节点，切换折叠状态
      if (nodeType === 'group') {
        const groupId = node.id();
        console.log('🔄 Toggle group collapse:', groupId);
        toggleGroupCollapse(groupId);
        onGroupingUpdate?.();
        return;
      }
      
      // 普通节点的处理逻辑
      const mediaType = node.data('mediaType');
      const videoUrl = node.data('video');
      const nodeData = node.data();
      
      console.log('Double click node:', node.id());
      console.log('Node data:', nodeData);
      console.log('Media type:', mediaType);
      console.log('Video URL:', videoUrl);
      
      if (mediaType === 'video' && videoUrl) {
        console.log('Playing video:', videoUrl);
        handleVideoPlay(videoUrl, node.data('label'));
      } else if (videoUrl) {
        // 即使mediaType不是video，但有videoUrl也播放
        console.log('Playing video (fallback):', videoUrl);
        handleVideoPlay(videoUrl, node.data('label'));
      } else {
        // 展开节点 - 获取邻居节点
        console.log('Expand node:', node.id());
        handleExpandNode(node.id());
      }
    });

    // 点击背景取消选择和关闭菜单
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNodeId(null);
        setContextMenuPosition(null);
        setContextMenuTarget(null);
      }
    });

    // 右键菜单 - 节点
    cy.on('cxttap', 'node', (event) => {
      event.preventDefault();
      const node = event.target;
      const renderedPosition = node.renderedPosition();
      const containerRect = containerRef.current?.getBoundingClientRect();
      
      if (containerRect) {
        setContextMenuPosition({
          top: containerRect.top + renderedPosition.y,
          left: containerRect.left + renderedPosition.x,
        });
        setContextMenuTarget(node);
      }
    });

    // 右键菜单 - 边
    cy.on('cxttap', 'edge', (event) => {
      event.preventDefault();
      const edge = event.target;
      const renderedMidpoint = edge.renderedMidpoint();
      const containerRect = containerRef.current?.getBoundingClientRect();
      
      if (containerRect) {
        setContextMenuPosition({
          top: containerRect.top + renderedMidpoint.y,
          left: containerRect.left + renderedMidpoint.x,
        });
        setContextMenuTarget(edge);
      }
    });

    // 鼠标悬停 - 显示提示框
    cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      const nodeType = node.data('type');
      const renderedPosition = node.renderedPosition();

      // 为分组节点显示特殊的提示信息
      if (nodeType === 'group') {
        const groupId = node.id();
        const group = groupingState.groups.find(g => g.id === groupId);
        setTooltipData({
          id: node.id(),
          label: node.data('label') || '分组',
          type: '分组',
          properties: {
            节点数量: group?.nodeIds.length || 0,
            状态: group?.collapsed ? '已折叠' : '已展开',
          },
        });
      } else {
        setTooltipData({
          id: node.id(),
          label: node.data('label'),
          type: node.data('type'),
          properties: node.data('properties'),
        });
      }
      
      setTooltipPosition({
        x: renderedPosition.x,
        y: renderedPosition.y,
      });
      setTooltipVisible(true);
    });

    // 鼠标离开 - 隐藏提示框
    cy.on('mouseout', 'node', () => {
      setTooltipVisible(false);
      setTooltipData(null);
    });

    cyRef.current = cy;

    // 清理函数
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [isDarkMode, setSelectedNodeId]);

  // 更新图数据
  useEffect(() => {
    if (!cyRef.current) {
      console.log('GraphCanvas - cyRef.current is null');
      return;
    }

    const cy = cyRef.current;
    console.log('🔄 GraphCanvas - Updating graph data, elements count:', cytoscapeElements.length);

    // 清空现有元素
    cy.elements().remove();

    // 添加新元素
    if (cytoscapeElements.length > 0) {
      console.log('Adding elements to cytoscape');
      cy.add(cytoscapeElements);
      console.log('Elements added, total nodes:', cy.nodes().length, 'edges:', cy.edges().length);

      // 重新生成并应用样式（确保新元素有正确的样式）
      const newStyles = generateDynamicStylesByNodeType(nodeTypeStyles, isDarkMode);
      cy.style(newStyles);
      console.log('🎨 GraphCanvas - Styles reapplied after adding elements');

      // 运行布局
      const layout = cy.layout(LAYOUT_CONFIGS.cose);
      layout.run();

      // 适应视口
      setTimeout(() => {
        cy.fit(undefined, 50);
        console.log('📐 GraphCanvas - Fit viewport completed');
      }, 100);
    } else {
      console.log('GraphCanvas - No elements to add');
    }
  }, [cytoscapeElements]);

  // 更新样式（主题或样式配置变化时）
  useEffect(() => {
    if (!cyRef.current) {
      console.log('GraphCanvas - cyRef.current is null in style update');
      return;
    }
    
    console.log('🎨 GraphCanvas - Style update triggered');
    console.log('🎨 GraphCanvas - Elements before style update:', cyRef.current.elements().length);
    console.log('🎨 GraphCanvas - nodeTypeStyles:', nodeTypeStyles);
    
    // 调试：打印所有节点的类型
    cyRef.current.nodes().forEach((node) => {
      console.log('Node:', node.id(), 'type:', node.data('type'), 'label:', node.data('label'));
    });
    
    applyNodeTypeStylesToCytoscape(cyRef.current, nodeTypeStyles);
    
    console.log('🎨 GraphCanvas - Elements after style update:', cyRef.current.elements().length);
  }, [isDarkMode, nodeTypeStyles]);

  // 应用过滤器
  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    const hasNodeFilter = activeFilters.nodeTypes.length > 0;
    const hasEdgeFilter = activeFilters.relationshipTypes.length > 0;

    // 如果没有过滤器，显示所有元素
    if (!hasNodeFilter && !hasEdgeFilter) {
      cy.elements().removeClass('hidden');
      return;
    }

    // 应用节点过滤器
    if (hasNodeFilter) {
      cy.nodes().forEach((node) => {
        const nodeType = node.data('type');
        if (activeFilters.nodeTypes.includes(nodeType)) {
          node.removeClass('hidden');
        } else {
          node.addClass('hidden');
        }
      });
    } else {
      cy.nodes().removeClass('hidden');
    }

    // 应用边过滤器
    if (hasEdgeFilter) {
      cy.edges().forEach((edge) => {
        const edgeType = edge.data('type');
        const sourceVisible = !edge.source().hasClass('hidden');
        const targetVisible = !edge.target().hasClass('hidden');

        if (
          activeFilters.relationshipTypes.includes(edgeType) &&
          sourceVisible &&
          targetVisible
        ) {
          edge.removeClass('hidden');
        } else {
          edge.addClass('hidden');
        }
      });
    } else {
      // 只隐藏连接到隐藏节点的边
      cy.edges().forEach((edge) => {
        const sourceVisible = !edge.source().hasClass('hidden');
        const targetVisible = !edge.target().hasClass('hidden');
        if (sourceVisible && targetVisible) {
          edge.removeClass('hidden');
        } else {
          edge.addClass('hidden');
        }
      });
    }

    // 重新运行布局（只对可见元素）
    const visibleElements = cy.elements().not('.hidden');
    if (visibleElements.length > 0) {
      const layout = visibleElements.layout(LAYOUT_CONFIGS.cose);
      layout.run();
    }
  }, [activeFilters]);

  const hasData = graphData && (graphData.nodes.length > 0 || graphData.edges.length > 0);
  const hasQueryResult = graphData !== null;
  const isEmptyResult = hasQueryResult && !hasData;
  console.log('🎨 GraphCanvas - Rendering, hasData:', hasData, 'elements:', cytoscapeElements.length);

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        bgcolor: 'background.default',
      }}
    >
      {/* Cytoscape 容器 - 始终渲染 */}
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: '100%',
          display: hasData ? 'block' : 'none',
        }}
      />

      {/* 空状态提示 - 只在没有数据时显示 */}
      {!hasData && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
          }}
        >
          <Typography variant="h5" gutterBottom>
            图谱画布
          </Typography>
          <Typography variant="body2">
            {isEmptyResult
              ? '查询无结果，数据库可能为空或查询条件不匹配。'
              : '执行 Cypher 查询以显示图谱'}
          </Typography>
          {isEmptyResult && (
            <Typography variant="caption" sx={{ mt: 0.5 }}>
              可尝试：MATCH (n) RETURN n LIMIT 25
            </Typography>
          )}
        </Box>
      )}

      <GraphControls cyRef={cyRef} />
      <Minimap cyRef={cyRef} />
      <NodeTooltip
        visible={tooltipVisible}
        x={tooltipPosition.x}
        y={tooltipPosition.y}
        nodeData={tooltipData}
      />

      {/* 右键上下文菜单 */}
      <ContextMenu
        cyRef={cyRef}
        anchorPosition={contextMenuPosition}
        onClose={() => {
          setContextMenuPosition(null);
          setContextMenuTarget(null);
        }}
        targetElement={contextMenuTarget}
      />

      {/* 视频播放对话框 */}
      <Dialog
        open={videoDialogOpen}
        onClose={handleVideoClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            minHeight: '400px',
            zIndex: 9999,
          },
        }}
        sx={{
          zIndex: 9999,
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {currentVideo?.title || '视频播放'}
          <IconButton onClick={handleVideoClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {currentVideo && (
            <video
              controls
              autoPlay
              style={{
                width: '100%',
                height: 'auto',
                maxHeight: '400px',
              }}
            >
              <source src={currentVideo.url} type="video/mp4" />
              您的浏览器不支持视频播放。
            </video>
          )}
        </DialogContent>
      </Dialog>

      {/* 性能警告对话框 */}
      <PerformanceWarningDialog
        open={showPerformanceWarning}
        nodeCount={pendingGraphData?.nodes.length || 0}
        onContinue={handlePerformanceContinue}
        onCancel={handlePerformanceCancel}
      />

      {/* 展开节点加载指示器 */}
      {isExpanding && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'primary.main',
            color: 'white',
            px: 2,
            py: 1,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            boxShadow: 2,
            zIndex: 1000,
          }}
        >
          <Typography variant="body2">正在展开节点...</Typography>
        </Box>
      )}
    </Box>
  );
}
