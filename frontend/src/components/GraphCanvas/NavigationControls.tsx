import { useState } from 'react';
import {
  IconButton,
  Tooltip,
  Paper,
  Box,
  Popover,
  Typography,
  Divider,
} from '@mui/material';
import {
  Search as SearchIcon,
  Bookmark as BookmarkIcon,
  Home as HomeIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import { NodeSearch } from './NodeSearch';
import type { RendererAPI } from '../../renderers/core/types';
import { useGraphStore } from '../../store/graphStore';

interface NavigationControlsProps {
  rendererRef: React.RefObject<RendererAPI | null>;
}

export function NavigationControls({ rendererRef }: NavigationControlsProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null);
  const [history] = useState<any[]>([]);
  const [historyIndex] = useState(-1);
  const { setSelectedNodeId } = useGraphStore();

  const handleNodeSelect = (nodeId: string) => {
    if (!rendererRef.current) return;
    rendererRef.current.setSearchHighlight({ nodeIds: [nodeId] });
    rendererRef.current.fitTo([nodeId], 80);
    setSelectedNodeId(nodeId);
  };

  const handleNodeHighlight = (nodeId: string | null) => {
    if (!rendererRef.current) return;
    if (nodeId) {
      rendererRef.current.setSearchHighlight({ nodeIds: [nodeId] });
    } else {
      rendererRef.current.clearSearchHighlight();
    }
  };

  const handleSearchOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSearchAnchor(event.currentTarget);
    setSearchOpen(true);
  };

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchAnchor(null);
  };

  const handleGoHome = () => {
    rendererRef.current?.fitTo(undefined, 50);
  };

  const handleHistoryBack = () => {
    console.log('History back');
  };

  const handleHistoryForward = () => {
    console.log('History forward');
  };

  return (
    <>
      <Paper
        elevation={3}
        sx={{
          position: 'absolute',
          top: 16,
          right: 72,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1,
          zIndex: 1000,
        }}
      >
        <Tooltip title="搜索节点" placement="left">
          <IconButton
            size="small"
            onClick={handleSearchOpen}
            color={searchOpen ? 'primary' : 'default'}
          >
            <SearchIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="后退" placement="left">
          <span>
            <IconButton size="small" onClick={handleHistoryBack} disabled={historyIndex <= 0}>
              <ArrowBackIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="前进" placement="left">
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

        <Tooltip title="适应全图" placement="left">
          <IconButton size="small" onClick={handleGoHome}>
            <HomeIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="视图书签" placement="left">
          <IconButton size="small">
            <BookmarkIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      <Popover
        open={searchOpen}
        anchorEl={searchAnchor}
        onClose={handleSearchClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            width: 350,
            maxWidth: 'calc(100vw - 32px)',
            p: 2,
          },
        }}
      >
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SearchIcon />
          节点搜索
        </Typography>

        <Divider sx={{ mb: 2 }} />

        <NodeSearch
          onNodeSelect={(nodeId) => {
            handleNodeSelect(nodeId);
            handleSearchClose();
          }}
          onNodeHighlight={handleNodeHighlight}
        />

        <Box sx={{ mt: 2, textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">
            点击搜索结果快速定位节点
          </Typography>
        </Box>
      </Popover>
    </>
  );
}
