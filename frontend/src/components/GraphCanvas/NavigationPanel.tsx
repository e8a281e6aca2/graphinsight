import { useState, useEffect } from 'react';
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
import type { Core } from 'cytoscape';
import { NodeSearch } from './NodeSearch';

interface ViewBookmark {
  id: string;
  name: string;
  timestamp: number;
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeId?: string;
}

interface NavigationHistory {
  zoom: number;
  pan: { x: number; y: number };
  timestamp: number;
}

interface NavigationPanelProps {
  cyRef: React.RefObject<Core | null>;
  isOpen: boolean;
  onClose: () => void;
}

export function NavigationPanel({ cyRef, isOpen, onClose }: NavigationPanelProps) {
  const [bookmarks, setBookmarks] = useState<ViewBookmark[]>([]);
  const [history, setHistory] = useState<NavigationHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [bookmarkName, setBookmarkName] = useState('');
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  // 从localStorage加载书签
  useEffect(() => {
    const savedBookmarks = localStorage.getItem('graph-bookmarks');
    if (savedBookmarks) {
      try {
        setBookmarks(JSON.parse(savedBookmarks));
      } catch (error) {
        console.error('Failed to load bookmarks:', error);
      }
    }
  }, []);

  // 保存书签到localStorage
  const saveBookmarks = (newBookmarks: ViewBookmark[]) => {
    setBookmarks(newBookmarks);
    localStorage.setItem('graph-bookmarks', JSON.stringify(newBookmarks));
  };

  // 添加到历史记录
  const addToHistory = () => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    const newHistoryItem: NavigationHistory = {
      zoom: cy.zoom(),
      pan: cy.pan(),
      timestamp: Date.now(),
    };

    // 如果当前不在历史记录的末尾，截断后面的记录
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newHistoryItem);

    // 限制历史记录数量
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }

    setHistory(newHistory);
  };

  // 监听视图变化，添加到历史记录
  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    let timeoutId: any;

    const handleViewportChange = () => {
      // 防抖，避免频繁添加历史记录
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        addToHistory();
      }, 1000) as any;
    };

    cy.on('viewport', handleViewportChange);

    return () => {
      cy.off('viewport', handleViewportChange);
      clearTimeout(timeoutId);
    };
  }, [cyRef, history, historyIndex]);

  // 处理节点选择
  const handleNodeSelect = (nodeId: string) => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    const node = cy.getElementById(nodeId);

    if (node.length > 0) {
      // 清除之前的选择
      cy.elements().removeClass('highlighted');
      
      // 高亮选中的节点
      node.addClass('highlighted');
      
      // 居中显示节点
      cy.animate({
        center: { eles: node },
        zoom: Math.max(cy.zoom(), 1.5),
      }, {
        duration: 500,
        easing: 'ease-out',
      });

      // 选择节点
      node.select();
    }
  };

  // 处理节点高亮
  const handleNodeHighlight = (nodeId: string | null) => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    
    // 清除之前的高亮
    if (highlightedNodeId) {
      const prevNode = cy.getElementById(highlightedNodeId);
      prevNode.removeClass('search-highlight');
    }

    // 添加新的高亮
    if (nodeId) {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        node.addClass('search-highlight');
      }
    }

    setHighlightedNodeId(nodeId);
  };

  // 创建书签
  const handleCreateBookmark = () => {
    if (!cyRef.current || !bookmarkName.trim()) return;

    const cy = cyRef.current;
    const selectedNodes = cy.nodes(':selected');
    
    const newBookmark: ViewBookmark = {
      id: `bookmark_${Date.now()}`,
      name: bookmarkName.trim(),
      timestamp: Date.now(),
      zoom: cy.zoom(),
      pan: cy.pan(),
      selectedNodeId: selectedNodes.length > 0 ? selectedNodes[0].id() : undefined,
    };

    saveBookmarks([...bookmarks, newBookmark]);
    setBookmarkName('');
    setBookmarkDialogOpen(false);
  };

  // 跳转到书签
  const handleGotoBookmark = (bookmark: ViewBookmark) => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    
    cy.animate({
      zoom: bookmark.zoom,
      pan: bookmark.pan,
    }, {
      duration: 500,
      easing: 'ease-out',
    });

    // 如果有选中的节点，高亮它
    if (bookmark.selectedNodeId) {
      setTimeout(() => {
        const node = cy.getElementById(bookmark.selectedNodeId!);
        if (node.length > 0) {
          cy.elements().unselect();
          node.select();
          node.addClass('highlighted');
        }
      }, 500);
    }
  };

  // 删除书签
  const handleDeleteBookmark = (bookmarkId: string) => {
    const newBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
    saveBookmarks(newBookmarks);
  };

  // 历史记录导航
  const handleHistoryBack = () => {
    if (historyIndex > 0 && cyRef.current) {
      const newIndex = historyIndex - 1;
      const historyItem = history[newIndex];
      
      cyRef.current.animate({
        zoom: historyItem.zoom,
        pan: historyItem.pan,
      }, {
        duration: 300,
        easing: 'ease-out',
      });

      setHistoryIndex(newIndex);
    }
  };

  const handleHistoryForward = () => {
    if (historyIndex < history.length - 1 && cyRef.current) {
      const newIndex = historyIndex + 1;
      const historyItem = history[newIndex];
      
      cyRef.current.animate({
        zoom: historyItem.zoom,
        pan: historyItem.pan,
      }, {
        duration: 300,
        easing: 'ease-out',
      });

      setHistoryIndex(newIndex);
    }
  };

  // 回到首页视图
  const handleGoHome = () => {
    if (!cyRef.current) return;

    cyRef.current.animate({
      fit: {
        eles: cyRef.current.elements(),
        padding: 50,
      },
    }, {
      duration: 500,
      easing: 'ease-out',
    });
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