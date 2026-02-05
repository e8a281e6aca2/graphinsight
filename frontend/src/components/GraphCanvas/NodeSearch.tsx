import { useState, useMemo } from 'react';
import {
  Box,
  TextField,
  Paper,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Fade,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  InputAdornment,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  MyLocation as LocationIcon,
} from '@mui/icons-material';
import { useGraphStore } from '../../store/graphStore';
import type { Node } from '../../store/graphStore';

interface SearchResult {
  node: Node;
  matchType: 'name' | 'id' | 'type' | 'property';
  matchValue: string;
  score: number;
}

interface NodeSearchProps {
  onNodeSelect: (nodeId: string) => void;
  onNodeHighlight: (nodeId: string | null) => void;
}

export function NodeSearch({ onNodeSelect, onNodeHighlight }: NodeSearchProps) {
  const { graphData } = useGraphStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [searchMode, setSearchMode] = useState<'all' | 'name' | 'type' | 'property'>('all');

  // 搜索结果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !graphData?.nodes) {
      return [];
    }

    const query = searchQuery.toLowerCase().trim();
    const results: SearchResult[] = [];

    graphData.nodes.forEach(node => {
      const scores: { type: SearchResult['matchType']; value: string; score: number }[] = [];

      // 根据搜索模式过滤搜索范围
      if (searchMode === 'all' || searchMode === 'name') {
        // 搜索节点ID和名称属性
        if (node.id.toLowerCase().includes(query)) {
          scores.push({
            type: 'id',
            value: node.id,
            score: node.id.toLowerCase() === query ? 100 : 80
          });
        }

        // 搜索名称相关属性
        const nameProps = ['name', 'title', '名称', '标题'];
        nameProps.forEach(prop => {
          const value = node.properties[prop];
          if (value && String(value).toLowerCase().includes(query)) {
            scores.push({
              type: 'name',
              value: `${prop}: ${value}`,
              score: String(value).toLowerCase() === query ? 95 : 75
            });
          }
        });
      }

      if (searchMode === 'all' || searchMode === 'type') {
        // 搜索节点类型
        node.labels.forEach(label => {
          if (label.toLowerCase().includes(query)) {
            scores.push({
              type: 'type',
              value: label,
              score: label.toLowerCase() === query ? 90 : 70
            });
          }
        });
      }

      if (searchMode === 'all' || searchMode === 'property') {
        // 搜索节点属性
        Object.entries(node.properties).forEach(([key, value]) => {
          const valueStr = String(value).toLowerCase();
          const keyStr = key.toLowerCase();

          if (valueStr.includes(query)) {
            scores.push({
              type: 'property',
              value: `${key}: ${value}`,
              score: valueStr === query ? 85 : 60
            });
          }

          if (keyStr.includes(query)) {
            scores.push({
              type: 'property',
              value: `${key}: ${value}`,
              score: keyStr === query ? 75 : 50
            });
          }
        });
      }

      // 取最高分的匹配
      if (scores.length > 0) {
        const bestMatch = scores.reduce((best, current) => 
          current.score > best.score ? current : best
        );

        results.push({
          node,
          matchType: bestMatch.type,
          matchValue: bestMatch.value,
          score: bestMatch.score
        });
      }
    });

    // 按分数排序，限制结果数量
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 30); // 增加结果数量
  }, [searchQuery, graphData, searchMode]);

  // 处理搜索输入
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setIsOpen(value.trim().length > 0);
  };

  // 处理结果选择
  const handleResultSelect = (result: SearchResult) => {
    setSelectedResult(result);
    setSearchQuery(getNodeDisplayName(result.node));
    setIsOpen(false);
    onNodeSelect(result.node.id);
  };

  // 处理结果悬停
  const handleResultHover = (result: SearchResult | null) => {
    onNodeHighlight(result?.node.id || null);
  };

  // 清除搜索
  const handleClear = () => {
    setSearchQuery('');
    setSelectedResult(null);
    setIsOpen(false);
    onNodeHighlight(null);
  };

  // 定位到选中节点
  const handleLocateNode = () => {
    if (selectedResult) {
      onNodeSelect(selectedResult.node.id);
    }
  };

  // 获取节点显示名称
  const getNodeDisplayName = (node: Node): string => {
    return node.properties.name || 
           node.properties.title || 
           node.properties['名称'] || 
           node.id;
  };

  // 获取节点类型颜色
  const getNodeTypeColor = (node: Node): string => {
    const colors = ['#1976d2', '#d32f2f', '#388e3c', '#f57c00', '#7b1fa2'];
    const typeIndex = node.labels[0]?.charCodeAt(0) || 0;
    return colors[typeIndex % colors.length];
  };

  // 获取匹配类型图标
  const getMatchTypeIcon = (matchType: SearchResult['matchType']) => {
    switch (matchType) {
      case 'name':
      case 'property':
        return '📝';
      case 'id':
        return 'ID';
      case 'type':
        return 'Type';
      default:
        return 'Search';
    }
  };

  const nodeCount = graphData?.nodes.length || 0;

  return (
    <Box sx={{ position: 'relative', width: '100%' }}>
      {/* 搜索模式选择 */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
        {[
          { key: 'all', label: '全部' },
          { key: 'name', label: '名称' },
          { key: 'type', label: '类型' },
          { key: 'property', label: '属性' },
        ].map(({ key, label }) => (
          <Chip
            key={key}
            label={label}
            size="small"
            variant={searchMode === key ? 'filled' : 'outlined'}
            color={searchMode === key ? 'primary' : 'default'}
            onClick={() => setSearchMode(key as any)}
            sx={{ 
              fontSize: '0.7rem', 
              height: 24,
              cursor: 'pointer',
              '&:hover': {
                backgroundColor: searchMode === key ? undefined : 'action.hover',
              },
            }}
          />
        ))}
      </Box>

      <TextField
        fullWidth
        size="small"
        placeholder={`搜索${searchMode === 'all' ? '节点' : 
          searchMode === 'name' ? '名称' : 
          searchMode === 'type' ? '类型' : '属性'}... (${nodeCount} 个节点)`}
        value={searchQuery}
        onChange={(e) => handleSearchChange(e.target.value)}
        onFocus={() => setIsOpen(searchQuery.trim().length > 0)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              {searchQuery && (
                <>
                  {selectedResult && (
                    <Tooltip title="定位节点">
                      <IconButton size="small" onClick={handleLocateNode}>
                        <LocationIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="清除搜索">
                    <IconButton size="small" onClick={handleClear}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'background.paper',
          },
        }}
      />

      {/* 搜索结果下拉框 */}
      <Fade in={isOpen && searchResults.length > 0}>
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1300,
            maxHeight: 400,
            overflow: 'auto',
            mt: 1,
          }}
        >
          <Box sx={{ p: 1 }}>
            <Typography variant="caption" color="text.secondary">
              找到 {searchResults.length} 个结果
            </Typography>
          </Box>
          
          <List dense>
            {searchResults.map((result, index) => (
              <ListItem
                key={`${result.node.id}-${index}`}
                onClick={() => handleResultSelect(result)}
                onMouseEnter={() => handleResultHover(result)}
                onMouseLeave={() => handleResultHover(null)}
                sx={{
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <ListItemAvatar>
                  <Avatar
                    sx={{
                      width: 32,
                      height: 32,
                      backgroundColor: getNodeTypeColor(result.node),
                      fontSize: '0.8rem',
                    }}
                  >
                    {getMatchTypeIcon(result.matchType)}
                  </Avatar>
                </ListItemAvatar>
                
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {getNodeDisplayName(result.node)}
                      </Typography>
                      <Chip
                        label={result.node.labels[0] || 'Unknown'}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.7rem', height: 20 }}
                      />
                    </Box>
                  }
                  secondary={
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        匹配: {result.matchValue}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        (评分: {result.score})
                      </Typography>
                    </Box>
                  }
                />
                
                <IconButton size="small" sx={{ opacity: 0.7 }}>
                  <LocationIcon fontSize="small" />
                </IconButton>
              </ListItem>
            ))}
          </List>
        </Paper>
      </Fade>

      {/* 无结果提示 */}
      <Fade in={isOpen && searchQuery.trim().length > 0 && searchResults.length === 0}>
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1300,
            mt: 1,
            p: 2,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            未找到匹配的节点
          </Typography>
          <Typography variant="caption" color="text.secondary">
            尝试搜索节点名称、ID、类型或属性
          </Typography>
        </Paper>
      </Fade>
    </Box>
  );
}