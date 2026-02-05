import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Tooltip,
  Divider,
  InputAdornment,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Collapse,
  Typography,
} from '@mui/material';
import {
  Search as SearchIcon,
  Bookmark as BookmarkIcon,
  History as HistoryIcon,
  FitScreen as FitScreenIcon,
  Clear as ClearIcon,
  ExpandLess,
  ExpandMore,
} from '@mui/icons-material';
import type { Core } from 'cytoscape';
import { useGraphStore } from '../../store/graphStore';
import { BookmarkManager } from '../GraphCanvas/BookmarkManager';

interface ToolBarProps {
  cyRef: React.RefObject<Core | null>;
}

interface SearchResult {
  id: string;
  label: string;
  type: string;
  score: number;
}

export const ToolBar: React.FC<ToolBarProps> = ({ cyRef }) => {
  const { graphData, setSelectedNodeId } = useGraphStore();
  
  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  
  // 书签管理状态
  const [bookmarkManagerOpen, setBookmarkManagerOpen] = useState(false);
  
  // 导航历史状态
  const [showHistory, setShowHistory] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState<any[]>([]);

  // 实时搜索
  useEffect(() => {
    if (!searchQuery.trim() || !graphData?.nodes) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    graphData.nodes.forEach(node => {
      let score = 0;
      const label = (node.properties?.name || node.id || '').toLowerCase();
      const type = (node.labels?.[0] || '').toLowerCase();
      
      // 计算匹配分数
      if (label.includes(query)) {
        score += label.startsWith(query) ? 10 : 5;
      }
      if (type.includes(query)) {
        score += 3;
      }
      
      // 搜索其他属性
      Object.values(node.properties || {}).forEach(value => {
        if (typeof value === 'string' && value.toLowerCase().includes(query)) {
          score += 2;
        }
      });

      if (score > 0) {
        results.push({
          id: node.id,
          label: node.properties?.name || node.id,
          type: node.labels?.[0] || 'Unknown',
          score
        });
      }
    });

    // 按分数排序，取前10个结果
    results.sort((a, b) => b.score - a.score);
    setSearchResults(results.slice(0, 10));
    setShowSearchResults(results.length > 0);
  }, [searchQuery, graphData]);

  // 搜索节点并定位
  const handleSearchResultClick = (result: SearchResult) => {
    if (cyRef.current) {
      const node = cyRef.current.getElementById(result.id);
      if (node.length > 0) {
        // 清除之前的高亮
        cyRef.current.elements().removeClass('search-highlight');
        
        // 高亮选中的节点
        node.addClass('search-highlight');
        
        // 聚焦到节点
        cyRef.current.animate({
          center: { eles: node },
          zoom: 2,
        }, {
          duration: 500,
        });
        
        // 选中节点
        setSelectedNodeId(result.id);
        
        // 3秒后移除高亮
        setTimeout(() => {
          if (cyRef.current) {
            cyRef.current.elements().removeClass('search-highlight');
          }
        }, 3000);
      }
    }
    
    setSearchQuery('');
    setShowSearchResults(false);
  };

  // 清空搜索
  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    if (cyRef.current) {
      cyRef.current.elements().removeClass('search-highlight');
    }
  };

  // 适应屏幕
  const handleFitScreen = () => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 50);
    }
  };

  // 加载导航历史
  useEffect(() => {
    const history = JSON.parse(localStorage.getItem('navigationHistory') || '[]');
    setNavigationHistory(history);
  }, []);

  return (
    <Box
      sx={{
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        p: 1.5,
      }}
    >
      {/* 搜索区域 */}
      <Box sx={{ position: 'relative', mb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="搜索节点..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton size="small" onClick={handleClearSearch}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              fontSize: '0.875rem',
            },
          }}
        />
        
        {/* 搜索结果下拉 */}
        <Collapse in={showSearchResults}>
          <Box
            sx={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 1000,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              mt: 0.5,
              maxHeight: 200,
              overflow: 'auto',
              boxShadow: 2,
            }}
          >
            <List dense>
              {searchResults.map((result) => (
                <ListItemButton
                  key={result.id}
                  onClick={() => handleSearchResultClick(result)}
                  sx={{ py: 0.5 }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                          {result.label}
                        </Typography>
                        <Chip
                          label={result.type}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.75rem', height: 20 }}
                        />
                      </Box>
                    }
                    secondary={`ID: ${result.id}`}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        </Collapse>
      </Box>

      {/* 工具按钮区域 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Tooltip title="书签管理">
          <IconButton
            size="small"
            onClick={() => setBookmarkManagerOpen(true)}
            sx={{ color: 'text.secondary' }}
          >
            <BookmarkIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="导航历史">
          <IconButton
            size="small"
            onClick={() => setShowHistory(!showHistory)}
            sx={{ color: 'text.secondary' }}
          >
            <HistoryIcon fontSize="small" />
            {showHistory ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem />

        <Tooltip title="适应屏幕">
          <IconButton
            size="small"
            onClick={handleFitScreen}
            sx={{ color: 'text.secondary' }}
          >
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* 搜索结果计数 */}
        {searchResults.length > 0 && (
          <Chip
            label={`${searchResults.length} 个结果`}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ fontSize: '0.75rem', ml: 'auto' }}
          />
        )}
      </Box>

      {/* 导航历史展开区域 */}
      <Collapse in={showHistory}>
        <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            导航历史
          </Typography>
          {navigationHistory.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              暂无历史记录
            </Typography>
          ) : (
            <List dense>
              {navigationHistory.slice(0, 5).map((item, index) => (
                <ListItem key={index} sx={{ py: 0.25 }}>
                  <ListItemText
                    primary={item.name || `视图 ${index + 1}`}
                    secondary={new Date(item.timestamp).toLocaleTimeString()}
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Collapse>

      {/* 书签管理对话框 */}
      <BookmarkManager
        open={bookmarkManagerOpen}
        onClose={() => setBookmarkManagerOpen(false)}
        cyRef={cyRef}
      />
    </Box>
  );
};