import React, { useMemo, useState, useEffect } from 'react';
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
import { useGraphStore } from '../../store/graphStore';
import { BookmarkManager } from '../GraphCanvas/BookmarkManager';
import type { RendererAPI } from '../../renderers/core/types';
import { loadNavigationHistory, type NavigationHistoryItem } from '../../utils/navigationStorage';

function displayText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

interface ToolBarProps {
  rendererRef: React.RefObject<RendererAPI | null>;
}

interface SearchResult {
  id: string;
  label: string;
  type: string;
  score: number;
}

export const ToolBar: React.FC<ToolBarProps> = ({ rendererRef }) => {
  const { graphData, setSelectedNodeId } = useGraphStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [lastSelectedQuery, setLastSelectedQuery] = useState('');

  const [bookmarkManagerOpen, setBookmarkManagerOpen] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryItem[]>(() => loadNavigationHistory());

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !graphData?.nodes) {
      return [] as SearchResult[];
    }

    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    graphData.nodes.forEach((node) => {
      let score = 0;
      const label = (displayText(node.properties?.name) || node.id).toLowerCase();
      const type = (node.labels?.[0] || '').toLowerCase();

      if (label.includes(query)) {
        score += label.startsWith(query) ? 10 : 5;
      }
      if (type.includes(query)) {
        score += 3;
      }

      Object.values(node.properties || {}).forEach((value) => {
        if (typeof value === 'string' && value.toLowerCase().includes(query)) {
          score += 2;
        }
      });

      if (score > 0) {
        results.push({
          id: node.id,
          label: displayText(node.properties?.name) || node.id,
          type: node.labels?.[0] || 'Unknown',
          score,
        });
      }
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 10);
  }, [searchQuery, graphData]);
  const showSearchResults = searchQuery !== lastSelectedQuery && searchResults.length > 0;

  const handleSearchResultClick = (result: SearchResult) => {
    const renderer = rendererRef.current;
    if (renderer) {
      const node = renderer.getNodeById(result.id);
      if (node) {
        renderer.setSearchHighlight({ nodeIds: [result.id] });
        renderer.fitTo([result.id], 80);
        setSelectedNodeId(result.id);

        setTimeout(() => {
          renderer.clearSearchHighlight();
        }, 3000);
      }
    }

    setLastSelectedQuery('');
    setSearchQuery('');
  };

  const handleClearSearch = () => {
    setLastSelectedQuery('');
    setSearchQuery('');
    rendererRef.current?.clearSearchHighlight();
  };

  const handleFitScreen = () => {
    rendererRef.current?.fitTo(undefined, 50);
  };

  useEffect(() => {
    if (!showHistory) return;
    const timer = window.setTimeout(() => {
      setNavigationHistory(loadNavigationHistory());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showHistory, bookmarkManagerOpen]);

  useEffect(() => {
    const handleHistoryUpdate = () => {
      window.setTimeout(() => {
        setNavigationHistory(loadNavigationHistory());
      }, 0);
    };

    window.addEventListener('navigationHistoryUpdated', handleHistoryUpdate);

    return () => {
      window.removeEventListener('navigationHistoryUpdated', handleHistoryUpdate);
    };
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

      <BookmarkManager
        open={bookmarkManagerOpen}
        onClose={() => setBookmarkManagerOpen(false)}
        rendererRef={rendererRef}
      />
    </Box>
  );
};
