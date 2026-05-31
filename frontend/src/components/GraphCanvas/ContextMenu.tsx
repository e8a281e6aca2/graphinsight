import React from 'react';
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
import type { RendererAPI, RendererEdge } from '../../renderers/core/types';
import { useGraphStore } from '../../store/graphStore';
import { addBookmark } from '../../utils/navigationStorage';

export type ContextMenuTarget = { type: 'node' | 'edge'; id: string } | null;

interface ContextMenuProps {
  rendererRef: React.RefObject<RendererAPI | null>;
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  target: ContextMenuTarget;
  hiddenNodeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
  onHideNode: (id: string) => void;
  onShowNode: (id: string) => void;
  onHideEdge: (id: string) => void;
  onShowEdge: (id: string) => void;
  viewportSize: { width: number; height: number };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  rendererRef,
  anchorPosition,
  onClose,
  target,
  hiddenNodeIds,
  hiddenEdgeIds,
  onHideNode,
  onShowNode,
  onHideEdge,
  onShowEdge,
  viewportSize,
}) => {
  const { setSelectedNodeId, createGroup, setNodeTypeFilter, setRelationshipTypeFilter } = useGraphStore();
  const elementType = target?.type || null;
  const elementId = target?.id || null;

  const getElementData = () => {
    if (!target || !rendererRef.current) return null;
    return target.type === 'node'
      ? rendererRef.current.getNodeById(target.id) || null
      : rendererRef.current.getEdgeById(target.id) || null;
  };

  const handleClose = () => {
    onClose();
  };

  const handleShowNodeDetails = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      setSelectedNodeId(elementData.id);
      rendererRef.current?.setActiveElement({ type: 'node', id: elementData.id });
    }
    handleClose();
  };

  const handleHideNode = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      onHideNode(elementData.id);
    }
    handleClose();
  };

  const handleShowNode = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      onShowNode(elementData.id);
    }
    handleClose();
  };

  const handleFocusNode = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      rendererRef.current?.fitTo([elementData.id], 120);
    }
    handleClose();
  };

  const handleExpandNeighbors = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      const neighbors = rendererRef.current?.getNeighbors(elementData.id) || [];
      rendererRef.current?.setActiveElement({ type: 'node', id: elementData.id });
      rendererRef.current?.fitTo([elementData.id, ...neighbors], 80);
    }
    handleClose();
  };

  const handleCreateGroup = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      const groupName = `Group_${Date.now()}`;
      createGroup(groupName, [elementData.id]);
    }
    handleClose();
  };

  const handleSelectSimilar = () => {
    const elementData = getElementData();
    if (elementType === 'node' && elementData) {
      setNodeTypeFilter([elementData.type]);
    }
    handleClose();
  };

  const handleHideEdge = () => {
    const elementData = getElementData();
    if (elementType === 'edge' && elementData) {
      onHideEdge(elementData.id);
    }
    handleClose();
  };

  const handleShowEdge = () => {
    const elementData = getElementData();
    if (elementType === 'edge' && elementData) {
      onShowEdge(elementData.id);
    }
    handleClose();
  };

  const handleFocusEdge = () => {
    const elementData = getElementData();
    if (elementType === 'edge' && elementData) {
      const edge = elementData as RendererEdge;
      rendererRef.current?.fitTo([edge.source, edge.target], 120);
    }
    handleClose();
  };

  const handleSelectSimilarEdges = () => {
    const elementData = getElementData();
    if (elementType === 'edge' && elementData) {
      const edge = elementData as RendererEdge;
      setRelationshipTypeFilter([edge.type]);
    }
    handleClose();
  };

  const handleBookmark = () => {
    const transform = rendererRef.current?.getTransform();
    if (!transform) {
      handleClose();
      return;
    }

    const center = {
      x: (viewportSize.width / 2 - transform.x) / transform.k,
      y: (viewportSize.height / 2 - transform.y) / transform.k,
    };

    const viewState = {
      id: `bookmark_${Date.now()}`,
      zoom: transform.k,
      center,
      timestamp: Date.now(),
      name: elementId
        ? `${elementType}_${elementId}`
        : `视图_${new Date().toLocaleTimeString()}`,
    };

    addBookmark(viewState);

    handleClose();
  };

  if (!anchorPosition || !target || !elementId) {
    return null;
  }

  const isNodeHidden = elementType === 'node' && hiddenNodeIds.has(elementId);
  const isEdgeHidden = elementType === 'edge' && hiddenEdgeIds.has(elementId);

  return (
    <Menu
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      open={Boolean(anchorPosition)}
      onClose={handleClose}
    >
      {/* 节点操作 */}
      {elementType === 'node' && (
        <>
          <MenuItem onClick={handleShowNodeDetails}>
            <ListItemIcon>
              <InfoIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>查看详情</ListItemText>
          </MenuItem>

          <MenuItem onClick={isNodeHidden ? handleShowNode : handleHideNode}>
            <ListItemIcon>
              {isNodeHidden ? <ShowIcon fontSize="small" /> : <HideIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{isNodeHidden ? '显示节点' : '隐藏节点'}</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleFocusNode}>
            <ListItemIcon>
              <FocusIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>聚焦节点</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleExpandNeighbors}>
            <ListItemIcon>
              <ExpandIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>展开邻居</ListItemText>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleSelectSimilar}>
            <ListItemIcon>
              <SelectIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>筛选同类型节点</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleCreateGroup}>
            <ListItemIcon>
              <GroupIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>创建分组</ListItemText>
          </MenuItem>
        </>
      )}

      {/* 边操作 */}
      {elementType === 'edge' && (
        <>
          <MenuItem onClick={isEdgeHidden ? handleShowEdge : handleHideEdge}>
            <ListItemIcon>
              {isEdgeHidden ? <ShowIcon fontSize="small" /> : <HideIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{isEdgeHidden ? '显示边' : '隐藏边'}</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleFocusEdge}>
            <ListItemIcon>
              <FocusIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>聚焦边</ListItemText>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleSelectSimilarEdges}>
            <ListItemIcon>
              <SelectIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>筛选同类型边</ListItemText>
          </MenuItem>
        </>
      )}

      <Divider />

      <MenuItem onClick={handleBookmark}>
        <ListItemIcon>
          <BookmarkIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>添加书签</ListItemText>
      </MenuItem>

      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1 }}>
        {elementType === 'node' ? `节点: ${elementId}` : `边: ${elementId}`}
      </Typography>
    </Menu>
  );
};
