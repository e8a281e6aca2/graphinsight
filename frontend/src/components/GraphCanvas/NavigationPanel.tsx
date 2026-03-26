import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Fade,
} from '@mui/material';
import {
  Navigation as NavigationIcon,
  BookmarkBorder as BookmarkBorderIcon,
  Delete as DeleteIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Home as HomeIcon,
} from '@mui/icons-material';
import { NodeSearch } from './NodeSearch';
import type { RendererAPI } from '../../renderers/core/types';
import { useGraphStore } from '../../store/graphStore';
import { addNavigationHistory, saveBookmarks } from '../../utils/navigationStorage';

interface ViewBookmark {
  id: string;
  name: string;
  timestamp: number;
  zoom: number;
  center: { x: number; y: number };
  selectedNodeId?: string;
}

interface NavigationHistory {
  zoom: number;
  center: { x: number; y: number };
  timestamp: number;
}

interface NavigationPanelProps {
  rendererRef: React.RefObject<RendererAPI | null>;
  isOpen: boolean;
  onClose: () => void;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);

function animateToView(
  renderer: RendererAPI,
  target: { zoom: number; center: { x: number; y: number } },
  duration = 500
) {
  const { width, height } = renderer.getViewportSize();
  const startTransform = renderer.getTransform();
  const startZoom = startTransform.k;
  const startCenter = {
    x: (width / 2 - startTransform.x) / startTransform.k,
    y: (height / 2 - startTransform.y) / startTransform.k,
  };

  const startTime = performance.now();

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = easeOut(t);

    const zoom = startZoom + (target.zoom - startZoom) * eased;
    const centerX = startCenter.x + (target.center.x - startCenter.x) * eased;
    const centerY = startCenter.y + (target.center.y - startCenter.y) * eased;

    renderer.zoomTo(zoom);
    renderer.panTo(centerX, centerY);

    if (t < 1) {
      requestAnimationFrame(tick);
    }
  };

  requestAnimationFrame(tick);
}

export function NavigationPanel({ rendererRef, isOpen, onClose }: NavigationPanelProps) {
  const [bookmarks, setBookmarks] = useState<ViewBookmark[]>([]);
  const [history, setHistory] = useState<NavigationHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [bookmarkName, setBookmarkName] = useState('');
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const { selectedNodeId, setSelectedNodeId } = useGraphStore();

  const historyRef = useRef<NavigationHistory[]>([]);
  const historyIndexRef = useRef(-1);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  // 从localStorage加载书签
  useEffect(() => {
    const normalizeBookmarks = (raw: string | null) => {
      if (!raw) return [] as ViewBookmark[];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [] as ViewBookmark[];

      const renderer = rendererRef.current;
      return parsed
        .map((item) => {
          if (item?.center && typeof item.center.x === 'number' && typeof item.center.y === 'number') {
            return item as ViewBookmark;
          }

          if (item?.pan && typeof item.pan.x === 'number' && typeof item.pan.y === 'number') {
            const viewport = renderer?.getViewportSize();
            const width = viewport?.width ?? 1;
            const height = viewport?.height ?? 1;
            const zoom = typeof item.zoom === 'number' ? item.zoom : 1;
            const center = {
              x: (width / 2 - item.pan.x) / zoom,
              y: (height / 2 - item.pan.y) / zoom,
            };
            return {
              id: String(item.id),
              name: String(item.name ?? '未命名书签'),
              timestamp: Number(item.timestamp ?? Date.now()),
              zoom,
              center,
              selectedNodeId: item.selectedNodeId,
            } as ViewBookmark;
          }

          return null;
        })
        .filter(Boolean) as ViewBookmark[];
    };

    try {
      const savedBookmarks = localStorage.getItem('graphBookmarks');
      let normalized = normalizeBookmarks(savedBookmarks);

      if (normalized.length === 0) {
        const legacyBookmarks = localStorage.getItem('graph-bookmarks');
        normalized = normalizeBookmarks(legacyBookmarks);
        if (normalized.length > 0) {
          saveBookmarks(normalized);
          localStorage.removeItem('graph-bookmarks');
        }
      }

      if (normalized.length > 0) {
        setBookmarks(normalized);
      }
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
    }
  }, [rendererRef]);

  // 保存书签到localStorage
  const persistBookmarks = (newBookmarks: ViewBookmark[]) => {
    setBookmarks(newBookmarks);
    saveBookmarks(newBookmarks);
  };

  const getViewState = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return null;
    const transform = renderer.getTransform();
    const { width, height } = renderer.getViewportSize();
    const center = {
      x: (width / 2 - transform.x) / transform.k,
      y: (height / 2 - transform.y) / transform.k,
    };
    return { zoom: transform.k, center };
  }, [rendererRef]);

  const isViewDifferent = (a: NavigationHistory, b: NavigationHistory) => {
    const zoomDiff = Math.abs(a.zoom - b.zoom);
    const centerDiff = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
    return zoomDiff > 0.01 || centerDiff > 4;
  };

  // 添加到历史记录
  const addToHistory = useCallback(() => {
    const view = getViewState();
    if (!view) return;

    const newHistoryItem: NavigationHistory = {
      zoom: view.zoom,
      center: view.center,
      timestamp: Date.now(),
    };

    const currentHistory = historyRef.current;
    const currentIndex = historyIndexRef.current;
    const lastItem = currentHistory[currentHistory.length - 1];

    if (lastItem && !isViewDifferent(lastItem, newHistoryItem)) {
      return;
    }

    const newHistory = currentHistory.slice(0, currentIndex + 1);
    newHistory.push(newHistoryItem);

    if (newHistory.length > 50) {
      newHistory.shift();
    }

    const newIndex = Math.min(newHistory.length - 1, currentIndex + 1);
    historyRef.current = newHistory;
    historyIndexRef.current = newIndex;
    setHistory(newHistory);
    setHistoryIndex(newIndex);

    addNavigationHistory({
      name: `视图 ${new Date(newHistoryItem.timestamp).toLocaleTimeString()}`,
      timestamp: newHistoryItem.timestamp,
      zoom: newHistoryItem.zoom,
      center: newHistoryItem.center,
    });
  }, [getViewState]);

  // 监听视图变化，添加到历史记录
  useEffect(() => {
    let timeoutId: number | null = null;
    let previous: { x: number; y: number; k: number } | null = null;

    const intervalId = window.setInterval(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const next = renderer.getTransform();
      if (!previous) {
        previous = next;
        return;
      }
      const moved =
        Math.abs(next.x - previous.x) > 0.5 ||
        Math.abs(next.y - previous.y) > 0.5 ||
        Math.abs(next.k - previous.k) > 0.001;

      if (moved) {
        previous = next;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(() => {
          addToHistory();
        }, 1000);
      }
    }, 200);

    return () => {
      window.clearInterval(intervalId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [addToHistory, rendererRef]);

  useEffect(() => {
    if (isOpen) {
      addToHistory();
    }
  }, [addToHistory, isOpen]);

  // 处理节点选择
  const handleNodeSelect = (nodeId: string) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const node = renderer.getNodeById(nodeId);
    if (!node) return;

    setSelectedNodeId(nodeId);
    renderer.setActiveElement({ type: 'node', id: nodeId });
    renderer.setSearchHighlight({ nodeIds: [nodeId] });

    if (node.x !== undefined && node.y !== undefined) {
      const transform = renderer.getTransform();
      const desiredZoom = Math.max(transform.k, 1.5);
      renderer.zoomTo(desiredZoom);
      renderer.panTo(node.x, node.y);
    } else {
      renderer.fitTo([nodeId], 80);
    }
  };

  // 处理节点高亮
  const handleNodeHighlight = (nodeId: string | null) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (highlightedNodeId) {
      renderer.clearSearchHighlight();
    }

    if (nodeId) {
      renderer.setSearchHighlight({ nodeIds: [nodeId] });
    }

    setHighlightedNodeId(nodeId);
  };

  // 创建书签
  const handleCreateBookmark = () => {
    const renderer = rendererRef.current;
    if (!renderer || !bookmarkName.trim()) return;

    const view = getViewState();
    if (!view) return;

    const newBookmark: ViewBookmark = {
      id: `bookmark_${Date.now()}`,
      name: bookmarkName.trim(),
      timestamp: Date.now(),
      zoom: view.zoom,
      center: view.center,
      selectedNodeId: selectedNodeId || undefined,
    };

    persistBookmarks([...bookmarks, newBookmark]);
    setBookmarkName('');
    setBookmarkDialogOpen(false);
  };

  // 跳转到书签
  const handleGotoBookmark = (bookmark: ViewBookmark) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    animateToView(renderer, { zoom: bookmark.zoom, center: bookmark.center }, 500);

    if (bookmark.selectedNodeId) {
      setTimeout(() => {
        renderer.setActiveElement({ type: 'node', id: bookmark.selectedNodeId! });
        renderer.setSearchHighlight({ nodeIds: [bookmark.selectedNodeId!] });
        setSelectedNodeId(bookmark.selectedNodeId!);
      }, 300);
    }
  };

  // 删除书签
  const handleDeleteBookmark = (bookmarkId: string) => {
    const newBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
    persistBookmarks(newBookmarks);
  };

  // 历史记录导航
  const handleHistoryBack = () => {
    if (historyIndex > 0 && rendererRef.current) {
      const newIndex = historyIndex - 1;
      const historyItem = history[newIndex];

      animateToView(rendererRef.current, { zoom: historyItem.zoom, center: historyItem.center }, 300);

      setHistoryIndex(newIndex);
    }
  };

  const handleHistoryForward = () => {
    if (historyIndex < history.length - 1 && rendererRef.current) {
      const newIndex = historyIndex + 1;
      const historyItem = history[newIndex];

      animateToView(rendererRef.current, { zoom: historyItem.zoom, center: historyItem.center }, 300);

      setHistoryIndex(newIndex);
    }
  };

  // 回到首页视图
  const handleGoHome = () => {
    rendererRef.current?.fitTo(undefined, 50);
  };

  return (
    <Fade in={isOpen}>
      <Paper
        elevation={8}
        sx={{
          position: 'absolute',
          top: 16,
          right: 128, // 放在第二列控制面板的左侧
          width: 320,
          maxWidth: 'calc(100vw - 160px)', // 响应式宽度
          maxHeight: 'calc(100vh - 100px)',
          zIndex: 1200,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          // 响应式调整
          '@media (max-width: 600px)': {
            right: 16,
            left: 16,
            width: 'auto',
            maxWidth: 'calc(100vw - 32px)',
          },
        }}
      >
        {/* 标题栏 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 2,
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NavigationIcon />
            <Typography variant="h6">图谱导航</Typography>
          </Box>
          
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ color: 'inherit' }}
          >
            ×
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {/* 搜索区域 */}
          <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              节点搜索
            </Typography>
            <NodeSearch
              onNodeSelect={handleNodeSelect}
              onNodeHighlight={handleNodeHighlight}
            />
          </Box>

          <Divider />

          {/* 导航控制 */}
          <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              导航控制
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Tooltip title="后退">
                <span>
                  <IconButton
                    size="small"
                    onClick={handleHistoryBack}
                    disabled={historyIndex <= 0}
                  >
                    <ArrowBackIcon />
                  </IconButton>
                </span>
              </Tooltip>
              
              <Tooltip title="前进">
                <span>
                  <IconButton
                    size="small"
                    onClick={handleHistoryForward}
                    disabled={historyIndex >= history.length - 1}
                  >
                    <ArrowForwardIcon />
                  </IconButton>
                </span>
              </Tooltip>
              
              <Tooltip title="适应全图">
                <IconButton size="small" onClick={handleGoHome}>
                  <HomeIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="创建书签">
                <IconButton
                  size="small"
                  onClick={() => setBookmarkDialogOpen(true)}
                >
                  <BookmarkBorderIcon />
                </IconButton>
              </Tooltip>
            </Box>

            <Typography variant="caption" color="text.secondary">
              历史记录: {historyIndex + 1} / {history.length}
            </Typography>
          </Box>

          <Divider />

          {/* 书签列表 */}
          <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              视图书签 ({bookmarks.length})
            </Typography>
            
            {bookmarks.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                暂无书签
                <br />
                点击上方按钮创建书签
              </Typography>
            ) : (
              <List dense>
                {bookmarks.map((bookmark) => (
                  <ListItem
                    key={bookmark.id}
                    onClick={() => handleGotoBookmark(bookmark)}
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      mb: 1,
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                    }}
                  >
                    <ListItemText
                      primary={bookmark.name}
                      secondary={
                        <Box>
                          <Typography variant="caption" display="block">
                            {new Date(bookmark.timestamp).toLocaleString()}
                          </Typography>
                          {bookmark.selectedNodeId && (
                            <Chip
                              label={`节点: ${bookmark.selectedNodeId}`}
                              size="small"
                              variant="outlined"
                              sx={{ mt: 0.5, fontSize: '0.7rem', height: 18 }}
                            />
                          )}
                        </Box>
                      }
                    />
                    
                    <ListItemSecondaryAction>
                      <Tooltip title="删除书签">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBookmark(bookmark.id);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>

        {/* 创建书签对话框 */}
        <Dialog
          open={bookmarkDialogOpen}
          onClose={() => setBookmarkDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>创建视图书签</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="书签名称"
              fullWidth
              variant="outlined"
              value={bookmarkName}
              onChange={(e) => setBookmarkName(e.target.value)}
              placeholder="输入书签名称..."
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              将保存当前的视图位置、缩放级别和选中的节点
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBookmarkDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleCreateBookmark}
              variant="contained"
              disabled={!bookmarkName.trim()}
            >
              创建
            </Button>
          </DialogActions>
        </Dialog>
      </Paper>
    </Fade>
  );
}
