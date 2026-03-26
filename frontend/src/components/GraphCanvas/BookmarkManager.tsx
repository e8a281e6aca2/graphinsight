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
import type { RendererAPI } from '../../renderers/core/types';
import { addNavigationHistory, loadBookmarks, saveBookmarks } from '../../utils/navigationStorage';

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
  rendererRef: React.RefObject<RendererAPI | null>;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);

function animateToView(renderer: RendererAPI, target: { zoom: number; center: { x: number; y: number } }, duration = 500) {
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

export const BookmarkManager: React.FC<BookmarkManagerProps> = ({
  open,
  onClose,
  rendererRef,
}) => {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);

  useEffect(() => {
    if (open) {
      setBookmarks(loadBookmarks());
    }
  }, [open]);

  const handleGoToBookmark = (bookmark: BookmarkItem) => {
    if (rendererRef.current) {
      animateToView(rendererRef.current, { zoom: bookmark.zoom, center: bookmark.center });

      addNavigationHistory({
        name: `跳转到: ${bookmark.name}`,
        timestamp: Date.now(),
        zoom: bookmark.zoom,
        center: bookmark.center,
      });
    }
    onClose();
  };

  const handleDeleteBookmark = (bookmarkId: string) => {
    const updatedBookmarks = bookmarks.filter((b) => b.id !== bookmarkId);
    setBookmarks(updatedBookmarks);
    saveBookmarks(updatedBookmarks);
  };

  const handleClearAll = () => {
    setBookmarks([]);
    saveBookmarks([]);
  };

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
        sx: { minHeight: '400px' },
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
