import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Typography,
  Box,
  Chip,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Bookmark as BookmarkIcon,
} from '@mui/icons-material';
import type { Core } from 'cytoscape';

interface BookmarkItem {
  id: string;
  name: string;
  zoom: number;
  center: { x: number; y: number };
  timestamp: number;
}

interface BookmarkManagerProps {
  open: boolean;
  onClose: () => void;
  cyRef: React.RefObject<Core | null>;
}

export const BookmarkManager: React.FC<BookmarkManagerProps> = ({
  open,
  onClose,
  cyRef,
}) => {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);

  // 加载书签
  useEffect(() => {
    if (open) {
      const savedBookmarks = JSON.parse(localStorage.getItem('graphBookmarks') || '[]');
      setBookmarks(savedBookmarks);
    }
  }, [open]);

  // 跳转到书签视图
  const handleGoToBookmark = (bookmark: BookmarkItem) => {
    if (cyRef.current) {
      cyRef.current.animate({
        zoom: bookmark.zoom,
        center: bookmark.center,
      }, {
        duration: 500,
      });
      
      // 添加到导航历史
      const historyItem = {
        name: `跳转到: ${bookmark.name}`,
        timestamp: Date.now(),
        zoom: bookmark.zoom,
        center: bookmark.center,
      };
      const history = JSON.parse(localStorage.getItem('navigationHistory') || '[]');
      history.unshift(historyItem);
      localStorage.setItem('navigationHistory', JSON.stringify(history.slice(0, 20)));
    }
    onClose();
  };

  // 删除书签
  const handleDeleteBookmark = (bookmarkId: string) => {
    const updatedBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
    setBookmarks(updatedBookmarks);
    localStorage.setItem('graphBookmarks', JSON.stringify(updatedBookmarks));
  };

  // 清空所有书签
  const handleClearAll = () => {
    setBookmarks([]);
    localStorage.removeItem('graphBookmarks');
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { minHeight: '400px' }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <BookmarkIcon />
        视图书签管理
        <Chip 
          label={`${bookmarks.length} 个书签`} 
          size="small" 
          color="primary" 
          variant="outlined"
        />
      </DialogTitle>
      
      <DialogContent>
        {bookmarks.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '200px',
              color: 'text.secondary',
            }}
          >
            <BookmarkIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
            <Typography variant="h6" gutterBottom>
              暂无书签
            </Typography>
            <Typography variant="body2" textAlign="center">
              在图谱中右键点击节点或边，选择"添加书签"来保存当前视图
            </Typography>
          </Box>
        ) : (
          <List>
            {bookmarks.map((bookmark) => (
              <ListItem
                key={bookmark.id}
                divider
                sx={{
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                        {bookmark.name}
                      </Typography>
                      <Chip
                        label={`${Math.round(bookmark.zoom * 100)}%`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      保存于 {formatTime(bookmark.timestamp)}
                    </Typography>
                  }
                />
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    onClick={() => handleGoToBookmark(bookmark)}
                    size="small"
                    sx={{ mr: 1 }}
                    title="跳转到此视图"
                  >
                    <ViewIcon />
                  </IconButton>
                  <IconButton
                    edge="end"
                    onClick={() => handleDeleteBookmark(bookmark.id)}
                    size="small"
                    color="error"
                    title="删除书签"
                  >
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      
      <DialogActions>
        {bookmarks.length > 0 && (
          <Button onClick={handleClearAll} color="error" variant="outlined">
            清空所有
          </Button>
        )}
        <Button onClick={onClose} variant="contained">
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
};