import React, { useState, useEffect } from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
} from '@mui/material';
import {
  Visibility as ShowIcon,
  VisibilityOff as HideIcon,
  CenterFocusStrong as FocusIcon,
  AccountTree as ExpandIcon,
  Bookmark as BookmarkIcon,
  Group as GroupIcon,
  Info as InfoIcon,
  SelectAll as SelectIcon,
} from '@mui/icons-material';
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import { useGraphStore } from '../../store/graphStore';

interface ContextMenuProps {
  cyRef: React.RefObject<Core | null>;
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  targetElement: NodeSingular | EdgeSingular | null;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  cyRef,
  anchorPosition,
  onClose,
  targetElement,
}) => {
  const { setSelectedNodeId, createGroup } = useGraphStore();
  const [elementType, setElementType] = useState<'node' | 'edge' | null>(null);
  const [elementData, setElementData] = useState<any>(null);

  useEffect(() => {
    if (targetElement) {
      if (targetElement.isNode()) {
        setElementType('node');
        setElementData(targetElement.data());
      } else if (targetElement.isEdge()) {
        setElementType('edge');
        setElementData(targetElement.data());
      }
    } else {
      setElementType(null);
      setElementData(null);
    }
  }, [targetElement]);

  const handleClose = () => {
    onClose();
  };

  // 节点操作
  const handleShowNodeDetails = () => {
    if (elementType === 'node' && elementData) {
      setSelectedNodeId(elementData.id);
    }
    handleClose();
  };

  const handleHideNode = () => {
    if (targetElement && targetElement.isNode()) {
      targetElement.style('display', 'none');
      // 同时隐藏连接的边
      targetElement.connectedEdges().style('display', 'none');
    }
    handleClose();
  };

  const handleShowNode = () => {
    if (targetElement && targetElement.isNode()) {
      targetElement.style('display', 'element');
      // 显示连接的边（如果目标节点也可见）
      targetElement.connectedEdges().forEach((edge: EdgeSingular) => {
        const source = edge.source();
        const target = edge.target();
        if (source.style('display') !== 'none' && target.style('display') !== 'none') {
          edge.style('display', 'element');
        }
      });
    }
    handleClose();
  };

  const handleFocusNode = () => {
    if (targetElement && targetElement.isNode() && cyRef.current) {
      cyRef.current.animate({
        center: { eles: targetElement },
        zoom: 2,
      }, {
        duration: 500,
      });
    }
    handleClose();
  };

  const handleExpandNeighbors = () => {
    if (targetElement && targetElement.isNode() && cyRef.current) {
      // 高亮显示邻居节点
      const neighbors = targetElement.neighborhood();
      cyRef.current.elements().removeClass('highlighted');
      neighbors.addClass('highlighted');
      targetElement.addClass('highlighted');
      
      // 聚焦到节点及其邻居
      cyRef.current.animate({
        fit: { eles: neighbors.union(targetElement), padding: 50 },
      }, {
        duration: 500,
      });
    }
    handleClose();
  };

  const handleCreateGroup = () => {
    if (targetElement && targetElement.isNode() && elementData) {
      const groupName = `Group_${Date.now()}`;
      createGroup(groupName, [elementData.id]);
    }
    handleClose();
  };

  const handleSelectSimilar = () => {
    if (targetElement && targetElement.isNode() && cyRef.current && elementData) {
      // 选择相同类型的所有节点
      const nodeLabels = elementData.labels || [];
      if (nodeLabels.length > 0) {
        const similarNodes = cyRef.current.nodes().filter((node: NodeSingular) => {
          const nodeData = node.data();
          const nodeLabelsSet = new Set(nodeData.labels || []);
          return nodeLabels.some((label: string) => nodeLabelsSet.has(label));
        });
        
        cyRef.current.elements().removeClass('selected');
        similarNodes.addClass('selected');
      }
    }
    handleClose();
  };

  // 边操作
  const handleHideEdge = () => {
    if (targetElement && targetElement.isEdge()) {
      targetElement.style('display', 'none');
    }
    handleClose();
  };

  const handleShowEdge = () => {
    if (targetElement && targetElement.isEdge()) {
      targetElement.style('display', 'element');
    }
    handleClose();
  };

  const handleFocusEdge = () => {
    if (targetElement && targetElement.isEdge() && cyRef.current) {
      const sourceNode = targetElement.source();
      const targetNode = targetElement.target();
      const elements = targetElement.union(sourceNode).union(targetNode);
      
      cyRef.current.animate({
        fit: { eles: elements, padding: 100 },
      }, {
        duration: 500,
      });
    }
    handleClose();
  };

  const handleSelectSimilarEdges = () => {
    if (targetElement && targetElement.isEdge() && cyRef.current && elementData) {
      // 选择相同类型的所有边
      const edgeType = elementData.type;
      if (edgeType) {
        const similarEdges = cyRef.current.edges().filter((edge: EdgeSingular) => {
          return edge.data('type') === edgeType;
        });
        
        cyRef.current.elements().removeClass('selected');
        similarEdges.addClass('selected');
      }
    }
    handleClose();
  };

  // 通用操作
  const handleBookmark = () => {
    if (cyRef.current) {
      const viewState = {
        id: `bookmark_${Date.now()}`,
        zoom: cyRef.current.zoom(),
        center: cyRef.current.center(),
        timestamp: Date.now(),
        name: elementData ? `${elementType}_${elementData.name || elementData.id || elementData.type}` : `视图_${new Date().toLocaleTimeString()}`
      };
      
      // 保存到localStorage
      const bookmarks = JSON.parse(localStorage.getItem('graphBookmarks') || '[]');
      bookmarks.push(viewState);
      localStorage.setItem('graphBookmarks', JSON.stringify(bookmarks));
    }
    handleClose();
  };

  const isNodeHidden = targetElement?.isNode() && targetElement.style('display') === 'none';
  const isEdgeHidden = targetElement?.isEdge() && targetElement.style('display') === 'none';

  if (!anchorPosition || !targetElement) {
    return null;
  }

  return (
    <Menu
      open={Boolean(anchorPosition)}
      onClose={handleClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      PaperProps={{
        sx: {
          minWidth: 200,
          maxWidth: 250,
        },
      }}
    >
      {/* 元素信息 */}
      <MenuItem disabled>
        <ListItemIcon>
          <InfoIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          <Typography variant="body2" color="text.secondary">
            {elementType === 'node' 
              ? `节点: ${elementData?.name || elementData?.id || 'Unknown'}`
              : `关系: ${elementData?.type || 'Unknown'}`
            }
          </Typography>
        </ListItemText>
      </MenuItem>
      
      <Divider />

      {/* 节点操作 */}
      {elementType === 'node' && (
        <>
          <MenuItem onClick={handleShowNodeDetails}>
            <ListItemIcon>
              <InfoIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="查看详情" />
          </MenuItem>

          <MenuItem onClick={handleFocusNode}>
            <ListItemIcon>
              <FocusIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="聚焦节点" />
          </MenuItem>

          <MenuItem onClick={handleExpandNeighbors}>
            <ListItemIcon>
              <ExpandIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="展开邻居" />
          </MenuItem>

          <Divider />

          <MenuItem onClick={isNodeHidden ? handleShowNode : handleHideNode}>
            <ListItemIcon>
              {isNodeHidden ? <ShowIcon fontSize="small" /> : <HideIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText primary={isNodeHidden ? "显示节点" : "隐藏节点"} />
          </MenuItem>

          <MenuItem onClick={handleSelectSimilar}>
            <ListItemIcon>
              <SelectIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="选择同类型" />
          </MenuItem>

          <MenuItem onClick={handleCreateGroup}>
            <ListItemIcon>
              <GroupIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="创建分组" />
          </MenuItem>
        </>
      )}

      {/* 边操作 */}
      {elementType === 'edge' && (
        <>
          <MenuItem onClick={handleFocusEdge}>
            <ListItemIcon>
              <FocusIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="聚焦关系" />
          </MenuItem>

          <Divider />

          <MenuItem onClick={isEdgeHidden ? handleShowEdge : handleHideEdge}>
            <ListItemIcon>
              {isEdgeHidden ? <ShowIcon fontSize="small" /> : <HideIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText primary={isEdgeHidden ? "显示关系" : "隐藏关系"} />
          </MenuItem>

          <MenuItem onClick={handleSelectSimilarEdges}>
            <ListItemIcon>
              <SelectIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="选择同类型" />
          </MenuItem>
        </>
      )}

      <Divider />

      {/* 通用操作 */}
      <MenuItem onClick={handleBookmark}>
        <ListItemIcon>
          <BookmarkIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="添加书签" />
      </MenuItem>
    </Menu>
  );
};