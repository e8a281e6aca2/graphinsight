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
import type { Core } from 'cytoscape';
import { NodeSearch } from './NodeSearch';

interface NavigationControlsProps {
  cyRef: React.RefObject<Core | null>;
}

export function NavigationControls({ cyRef }: NavigationControlsProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null);
  const [history] = useState<any[]>([]);
  const [historyIndex] = useState(-1);

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
    cy.elements().removeClass('search-highlight');

    // 添加新的高亮
    if (nodeId) {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        node.addClass('search-highlight');
      }
    }
  };

  // 打开搜索面板
  const handleSearchOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSearchAnchor(event.currentTarget);
    setSearchOpen(true);
  };

  // 关闭搜索面板
  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchAnchor(null);
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

  // 历史记录导航
  const handleHistoryBack = () => {
    // TODO: 实现历史记录后退
    console.log('History back');
  };

  const handleHistoryForward = () => {
    // TODO: 实现历史记录前进
    console.log('History forward');
  };

  return (
    <>
      <Paper
        elevation={3}
        sx={{
          position: 'absolute',
          top: 16,
          right: 72, // 与第一列保持间距
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1,
          zIndex: 1000,
        }}
      >
        {/* 搜索按钮 */}
        <Tooltip title="搜索节点" placement="left">
          <IconButton 
            size="small" 
            onClick={handleSearchOpen}
            color={searchOpen ? 'primary' : 'default'}
          >
            <SearchIcon />
          </IconButton>
        </Tooltip>

        {/* 历史记录控制 */}
        <Tooltip title="后退" placement="left">
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

        {/* 回到首页 */}
        <Tooltip title="适应全图" placement="left">
          <IconButton size="small" onClick={handleGoHome}>
            <HomeIcon />
          </IconButton>
        </Tooltip>

        {/* 书签按钮 */}
        <Tooltip title="视图书签" placement="left">
          <IconButton size="small">
            <BookmarkIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* 搜索面板 */}
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