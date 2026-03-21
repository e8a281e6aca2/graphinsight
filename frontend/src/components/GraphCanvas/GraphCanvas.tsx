import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Box, Typography, Dialog, DialogTitle, DialogContent, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useGraphStore } from '../../store/graphStore';
import { adaptGraphData } from '../../renderers/core/adapter';
import { createRenderer } from '../../renderers/canvas2d/renderer';
import { createRenderer3D } from '../../renderers/force3d/renderer';
import type { RendererAPI, RendererActiveElement } from '../../renderers/core/types';
import { GraphControls } from './GraphControls';
import { NodeTooltip } from './NodeTooltip';
import { Minimap } from './Minimap';
import { ContextMenu, type ContextMenuTarget } from './ContextMenu';
import { PerformanceWarningDialog } from './PerformanceWarningDialog';
import { NavigationPanel } from './NavigationPanel';
import { reportClientLog } from '../../services/clientLog';
import { buildApiUrl } from '../../utils/apiBase';

interface GraphCanvasProps {
  rendererRef?: React.RefObject<RendererAPI | null>;
  onGroupingUpdate?: () => void;
}

export function GraphCanvas({ rendererRef: externalRendererRef, onGroupingUpdate }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const internalRendererRef = useRef<RendererAPI | null>(null);
  const rendererRef = externalRendererRef || internalRendererRef;
  const activeElementRef = useRef<RendererActiveElement | null>(null);
  const rendererDataRef = useRef<any>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // 提示框状态
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [tooltipData, setTooltipData] = useState<any>(null);

  // 视频播放状态
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<{ url: string; title: string } | null>(null);

  // 右键菜单状态
  const [contextMenuPosition, setContextMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTarget>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [rendererError, setRendererError] = useState<string | null>(null);

  useEffect(() => {
    if (viewMode === '3d' && navigationOpen) {
      setNavigationOpen(false);
    }
  }, [navigationOpen, viewMode]);

  // 性能警告状态
  const [showPerformanceWarning, setShowPerformanceWarning] = useState(false);
  const [pendingGraphData, setPendingGraphData] = useState<any>(null);
  const [userConfirmedLargeGraph, setUserConfirmedLargeGraph] = useState(false);
  const PERFORMANCE_THRESHOLD = 500;

  const graphData = useGraphStore((state) => state.graphData);
  const setGraphData = useGraphStore((state) => state.setGraphData);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useGraphStore((state) => state.setSelectedNodeId);
  const activeFilters = useGraphStore((state) => state.activeFilters);
  const nodeTypeStyles = useGraphStore((state) => state.nodeTypeStyles);
  const groupingState = useGraphStore((state) => state.groupingState);
  const toggleGroupCollapse = useGraphStore((state) => state.toggleGroupCollapse);
  const isDarkMode = useGraphStore((state) => state.isDarkMode);
  const selectedCitation = useGraphStore((state) => state.selectedCitation);
  const activeWorkspaceTab = useGraphStore((state) => state.activeWorkspaceTab);
  const rendererKey = useMemo(
    () => (viewMode === '3d' ? (isDarkMode ? '3d-dark' : '3d-light') : '2d'),
    [viewMode, isDarkMode]
  );

  const groupingStateRef = useRef(groupingState);
  const graphDataRef = useRef(graphData);
  const onGroupingUpdateRef = useRef(onGroupingUpdate);
  const isExpandingRef = useRef(false);

  useEffect(() => {
    groupingStateRef.current = groupingState;
  }, [groupingState]);

  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  useEffect(() => {
    onGroupingUpdateRef.current = onGroupingUpdate;
  }, [onGroupingUpdate]);

  // 展开节点状态
  const [isExpanding, setIsExpanding] = useState(false);

  useEffect(() => {
    isExpandingRef.current = isExpanding;
  }, [isExpanding]);

  // 过滤隐藏状态
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const [hiddenEdgeIds, setHiddenEdgeIds] = useState<Set<string>>(new Set());

  const handleVideoPlay = useCallback((videoUrl: string, title: string) => {
    setCurrentVideo({ url: videoUrl, title });
    setVideoDialogOpen(true);
  }, []);

  const handleExpandNode = useCallback(async (nodeId: string) => {
    if (isExpandingRef.current) return;

    setIsExpanding(true);

    try {
      const response = await fetch(buildApiUrl('/expand'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: nodeId,
          direction: 'both',
          limit: 20,
        }),
      });

      const data = await response.json();

      if (data.nodes && data.nodes.length > 0) {
        const currentData = graphDataRef.current || {
          nodes: [],
          edges: [],
          stats: { nodeCount: 0, edgeCount: 0, executionTime: 0 },
        };

        const existingNodeIds = new Set(currentData.nodes.map((n: any) => n.id));
        const newNodes = data.nodes.filter((n: any) => !existingNodeIds.has(n.id));

        const existingEdgeIds = new Set(currentData.edges.map((e: any) => e.id));
        const newEdges = data.edges.filter((e: any) => !existingEdgeIds.has(e.id));

        const mergedData = {
          nodes: [...currentData.nodes, ...newNodes],
          edges: [...currentData.edges, ...newEdges],
          stats: {
            nodeCount: currentData.nodes.length + newNodes.length,
            edgeCount: currentData.edges.length + newEdges.length,
            executionTime: data.stats?.executionTime || 0,
          },
        };

        setGraphData(mergedData);
      }
    } catch (error) {
      console.error('Failed to expand node:', error);
    } finally {
      setIsExpanding(false);
    }
  }, [setGraphData]);

  const handleVideoClose = () => {
    setVideoDialogOpen(false);
    setCurrentVideo(null);
  };

  const handlePerformanceContinue = () => {
    setShowPerformanceWarning(false);
    setPendingGraphData(null);
    setUserConfirmedLargeGraph(true);
  };

  const handlePerformanceCancel = () => {
    setShowPerformanceWarning(false);
    setPendingGraphData(null);
    setUserConfirmedLargeGraph(false);
    const emptyData = { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, executionTime: 0 } };
    setGraphData(emptyData);
  };

  useEffect(() => {
    if (graphData && graphData.nodes.length > 0) {
      setUserConfirmedLargeGraph(false);
    }
  }, [graphData?.stats?.executionTime]);

  const rendererData = useMemo(() => {
    if (graphData && graphData.nodes.length > PERFORMANCE_THRESHOLD && !userConfirmedLargeGraph && !pendingGraphData) {
      setPendingGraphData(graphData);
      setShowPerformanceWarning(true);
      return null;
    }

    return adaptGraphData(graphData, nodeTypeStyles);
  }, [graphData, nodeTypeStyles, pendingGraphData, userConfirmedLargeGraph]);

  useEffect(() => {
    rendererDataRef.current = rendererData;
  }, [rendererData]);

  const collapsedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    groupingState.groups.forEach((group) => {
      if (group.collapsed) {
        group.nodeIds.forEach((id) => ids.add(id));
      }
    });
    return ids;
  }, [groupingState.groups]);

  const handleHideNode = useCallback((id: string) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleShowNode = useCallback((id: string) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleHideEdge = useCallback((id: string) => {
    setHiddenEdgeIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleShowEdge = useCallback((id: string) => {
    setHiddenEdgeIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleRendererClick = useCallback((payload: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => {
    if (!rendererRef.current) return;

    if (payload.type === 'node' && payload.id) {
      setSelectedNodeId(payload.id);
      activeElementRef.current = { type: 'node', id: payload.id };
      rendererRef.current.setActiveElement(activeElementRef.current);
      return;
    }

    if (payload.type === 'edge' && payload.id) {
      setSelectedNodeId(null);
      activeElementRef.current = { type: 'edge', id: payload.id };
      rendererRef.current.setActiveElement(activeElementRef.current);
      return;
    }

    setSelectedNodeId(null);
    activeElementRef.current = null;
    rendererRef.current.setActiveElement(null);
    setContextMenuPosition(null);
    setContextMenuTarget(null);
  }, [rendererRef, setSelectedNodeId]);

  const handleRendererDoubleClick = useCallback((payload: { type: 'node' | 'background'; id?: string }) => {
    if (payload.type !== 'node' || !payload.id || !rendererRef.current) return;

    const node = rendererRef.current.getNodeById(payload.id);
    if (!node) return;

    if (node.type === 'group') {
      toggleGroupCollapse(node.id);
      onGroupingUpdateRef.current?.();
      return;
    }

    const videoUrl = node.video || node.originalVideoUrl;

    if ((node.mediaType === 'video' || node.isVideo) && videoUrl) {
      handleVideoPlay(videoUrl, node.label);
      return;
    }

    if (videoUrl) {
      handleVideoPlay(videoUrl, node.label);
      return;
    }

    handleExpandNode(node.id);
  }, [handleExpandNode, handleVideoPlay, toggleGroupCollapse, rendererRef]);

  const handleRendererContextMenu = useCallback((payload: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => {
    if (payload.type === 'background') {
      setContextMenuPosition(null);
      setContextMenuTarget(null);
      return;
    }

    if (payload.id) {
      setContextMenuPosition({ top: payload.y, left: payload.x });
      setContextMenuTarget({ type: payload.type, id: payload.id });
    }
  }, []);

  const handleRendererHover = useCallback((payload: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => {
    if (!rendererRef.current) return;

    if (payload.type !== 'node' || !payload.id) {
      setTooltipVisible(false);
      setTooltipData(null);
      return;
    }

    const node = rendererRef.current.getNodeById(payload.id);
    if (!node) return;

    if (node.type === 'group') {
      const group = groupingStateRef.current.groups.find((g) => g.id === node.id);
      setTooltipData({
        id: node.id,
        label: node.label || '分组',
        type: '分组',
        properties: {
          节点数量: group?.nodeIds.length || 0,
          状态: group?.collapsed ? '已折叠' : '已展开',
        },
      });
    } else {
      setTooltipData({
        id: node.id,
        label: node.label,
        type: node.type,
        properties: node.properties,
      });
    }

    setTooltipPosition({ x: payload.x, y: payload.y });
    setTooltipVisible(true);
  }, [rendererRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container3d = threeContainerRef.current;
    const is3D = rendererKey !== '2d';
    if (!is3D && !canvas) return;
    if (is3D && !container3d) return;

    setRendererError(null);
    const styleName = rendererKey === '3d-dark' ? 'kgCosmic' : 'kgVivid';
    const maxAttempts = is3D ? 3 : 1;
    const retryDelayMs = 400;
    let renderer: RendererAPI | null = null;
    let disposed = false;
    let retryTimer: number | null = null;
    let attempt = 0;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const logInitFailure = (error: unknown, attemptNo: number) => {
      const errText = error instanceof Error ? error.message : String(error);
      if (is3D) {
        const isFinal = attemptNo >= maxAttempts;
        reportClientLog({
          level: isFinal ? 'error' : 'warn',
          message: isFinal
            ? `3D 渲染器初始化失败（已重试 ${Math.max(0, maxAttempts - 1)} 次）`
            : `3D 渲染器初始化失败，准备重试（${attemptNo}/${maxAttempts}）`,
          source: 'renderer3d',
          event: 'init',
          context: {
            error: errText,
            attempt: attemptNo,
            maxAttempts,
            styleName,
          },
        });
      } else {
        reportClientLog({
          level: 'error',
          message: '2D 渲染器初始化失败',
          source: 'renderer2d',
          event: 'init',
          context: {
            error: errText,
          },
        });
      }
    };

    const initRenderer = () => {
      if (disposed) return;
      attempt += 1;
      try {
        renderer = !is3D
          ? createRenderer(
              canvas!,
              {
                onClick: handleRendererClick,
                onDoubleClick: handleRendererDoubleClick,
                onContextMenu: handleRendererContextMenu,
                onHover: handleRendererHover,
              },
              { minZoom: 0.25, maxZoom: 3, initialZoom: 0.5 }
            )
          : createRenderer3D(
              container3d!,
              {
                onClick: handleRendererClick,
                onDoubleClick: handleRendererDoubleClick,
                onContextMenu: handleRendererContextMenu,
                onHover: handleRendererHover,
              },
              {
                minZoom: 0.25,
                maxZoom: 3,
                initialZoom: 0.5,
                styleName,
              }
            );
      } catch (error) {
        console.error('Failed to initialize renderer:', error);
        logInitFailure(error, attempt);
        if (is3D && attempt < maxAttempts) {
          retryTimer = window.setTimeout(initRenderer, retryDelayMs);
          return;
        }
        if (!disposed) {
          setRendererError(
            is3D
              ? '3D 渲染器初始化失败，已自动重试，请查看日志面板。'
              : '渲染器初始化失败。'
          );
        }
        return;
      }

      if (disposed) {
        renderer?.destroy();
        return;
      }

      rendererRef.current = renderer;
      if (rendererDataRef.current) {
        renderer.updateData(rendererDataRef.current);
      }
      if (is3D && attempt > 1) {
        reportClientLog({
          level: 'info',
          message: `3D 渲染器初始化成功（重试 ${attempt - 1} 次）`,
          source: 'renderer3d',
          event: 'init',
          context: {
            attempt,
            styleName,
          },
        });
      }
    };

    initRenderer();

    return () => {
      disposed = true;
      clearRetryTimer();
      renderer?.destroy();
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
    };
  }, [
    handleRendererClick,
    handleRendererContextMenu,
    handleRendererDoubleClick,
    handleRendererHover,
    rendererRef,
    rendererKey,
  ]);

  useEffect(() => {
    if (!rendererRef.current || !rendererData) return;
    rendererRef.current.updateData(rendererData);
  }, [rendererData, rendererRef, viewMode, rendererKey]);

  useEffect(() => {
    if (!rendererRef.current) return;

    const combinedHiddenNodes = new Set<string>([...hiddenNodeIds, ...collapsedNodeIds]);
    rendererRef.current.setFilter({
      nodeTypes: activeFilters.nodeTypes,
      edgeTypes: activeFilters.relationshipTypes,
      hiddenNodeIds: combinedHiddenNodes,
      hiddenEdgeIds,
    });
  }, [activeFilters, collapsedNodeIds, hiddenEdgeIds, hiddenNodeIds, rendererRef, viewMode, rendererKey]);

  useEffect(() => {
    if (!rendererRef.current) return;

    if (selectedNodeId) {
      activeElementRef.current = { type: 'node', id: selectedNodeId };
      rendererRef.current.setActiveElement(activeElementRef.current);
      return;
    }

    if (activeElementRef.current?.type === 'node') {
      activeElementRef.current = null;
      rendererRef.current.setActiveElement(null);
    }
  }, [rendererRef, selectedNodeId, viewMode, rendererKey]);

  useEffect(() => {
    if (!rendererRef.current || !rendererData || rendererData.nodes.length === 0) return;

    const timer = window.setTimeout(() => {
      rendererRef.current?.fitTo(undefined, 50);
    }, 200);

    return () => window.clearTimeout(timer);
  }, [graphData?.stats?.executionTime, rendererData, rendererRef, viewMode, rendererKey]);

  useEffect(() => {
    if (!rendererRef.current) return;
    if (!selectedCitation || !rendererDataRef.current) {
      rendererRef.current.clearSearchHighlight();
      return;
    }

    const docId = selectedCitation.id.split('-')[0];
    const matches = rendererDataRef.current.nodes
      .filter((node: any) => {
        const props = node.properties || {};
        if (props.chunk_id && props.chunk_id === selectedCitation.id) return true;
        if (props.doc_id && props.doc_id === docId) return true;
        if (props.name && selectedCitation.title && props.name === selectedCitation.title) return true;
        return false;
      })
      .map((node: any) => node.id);

    const entityMatches = new Set<string>();
    if (rendererRef.current && matches.length > 0) {
      matches.forEach((id) => {
        const neighbors = rendererRef.current?.getNeighbors(id) || [];
        neighbors.forEach((neighborId) => {
          const node = rendererRef.current?.getNodeById(neighborId);
          if (node?.type === 'Entity') {
            entityMatches.add(neighborId);
          }
        });
      });
    }

    const highlightIds = Array.from(new Set([...matches, ...entityMatches]));
    if (highlightIds.length > 0) {
      rendererRef.current.setSearchHighlight({ nodeIds: highlightIds });
      if (activeWorkspaceTab === 'graph') {
        rendererRef.current.fitTo(highlightIds, 80);
      }
    } else {
      rendererRef.current.clearSearchHighlight();
    }
  }, [selectedCitation, activeWorkspaceTab, rendererRef, viewMode, rendererKey]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);


  const hasData = graphData && (graphData.nodes.length > 0 || graphData.edges.length > 0);
  const hasQueryResult = graphData !== null;
  const isEmptyResult = hasQueryResult && !hasData;

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        bgcolor: 'background.default',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: hasData && viewMode === '2d' ? 'block' : 'none',
        }}
      />
      <Box
        ref={threeContainerRef}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          display: hasData && viewMode === '3d' ? 'block' : 'none',
        }}
      />

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

      {rendererError && (
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
            color: 'error.main',
            bgcolor: 'rgba(0, 0, 0, 0.04)',
            backdropFilter: 'blur(2px)',
            zIndex: 10,
            textAlign: 'center',
            px: 2,
          }}
        >
          <Typography variant="h6" sx={{ mb: 1 }}>
            渲染失败
          </Typography>
          <Typography variant="body2">
            {rendererError}
          </Typography>
        </Box>
      )}

      <GraphControls
        rendererRef={rendererRef}
        onToggleNavigation={viewMode === '2d' ? () => setNavigationOpen((prev) => !prev) : undefined}
        navigationOpen={navigationOpen}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode((prev) => (prev === '2d' ? '3d' : '2d'))}
      />
      {viewMode === '2d' && <Minimap rendererRef={rendererRef} viewportSize={canvasSize} />}
      {viewMode === '2d' && (
        <NavigationPanel
          rendererRef={rendererRef}
          isOpen={navigationOpen}
          onClose={() => setNavigationOpen(false)}
        />
      )}
      <NodeTooltip
        visible={tooltipVisible}
        x={tooltipPosition.x}
        y={tooltipPosition.y}
        nodeData={tooltipData}
      />

      <ContextMenu
        rendererRef={rendererRef}
        anchorPosition={contextMenuPosition}
        onClose={() => {
          setContextMenuPosition(null);
          setContextMenuTarget(null);
        }}
        target={contextMenuTarget}
        hiddenNodeIds={hiddenNodeIds}
        hiddenEdgeIds={hiddenEdgeIds}
        onHideNode={handleHideNode}
        onShowNode={handleShowNode}
        onHideEdge={handleHideEdge}
        onShowEdge={handleShowEdge}
        viewportSize={canvasSize}
      />


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

      <PerformanceWarningDialog
        open={showPerformanceWarning}
        nodeCount={pendingGraphData?.nodes.length || 0}
        onContinue={handlePerformanceContinue}
        onCancel={handlePerformanceCancel}
      />

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
