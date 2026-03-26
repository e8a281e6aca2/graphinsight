import {
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import {
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Navigation as NavigationIcon,
  ThreeDRotation as ThreeDIcon,
} from '@mui/icons-material';
import type { RendererAPI } from '../../renderers/core/types';

interface GraphControlsProps {
  rendererRef: React.RefObject<RendererAPI | null>;
  onToggleNavigation?: () => void;
  navigationOpen?: boolean;
  viewMode?: '2d' | '3d';
  onToggleViewMode?: () => void;
}

export function GraphControls({
  rendererRef,
  onToggleNavigation,
  navigationOpen,
  viewMode = '2d',
  onToggleViewMode,
}: GraphControlsProps) {
  const handleZoomIn = () => {
    rendererRef.current?.zoomBy(1.2);
    if (viewMode === '2d') {
      rendererRef.current?.center();
    }
  };

  const handleZoomOut = () => {
    rendererRef.current?.zoomBy(0.8);
    if (viewMode === '2d') {
      rendererRef.current?.center();
    }
  };





  return (
    <>
      {/* 主控制面板 - 缩放控制 */}
      <Paper
        elevation={3}
        sx={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1,
          zIndex: 1000,
        }}
      >
        <Tooltip title="放大" placement="left">
          <IconButton size="small" onClick={handleZoomIn}>
            <ZoomInIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="缩小" placement="left">
          <IconButton size="small" onClick={handleZoomOut}>
            <ZoomOutIcon />
          </IconButton>
        </Tooltip>

        {onToggleNavigation && (
          <Tooltip title="图谱导航" placement="left">
            <IconButton
              size="small"
              onClick={onToggleNavigation}
              color={navigationOpen ? 'primary' : 'default'}
            >
              <NavigationIcon />
            </IconButton>
          </Tooltip>
        )}

        {onToggleViewMode && (
          <Tooltip title={viewMode === '3d' ? '切换到 2D' : '切换到 3D'} placement="left">
            <IconButton
              size="small"
              onClick={onToggleViewMode}
              color={viewMode === '3d' ? 'primary' : 'default'}
            >
              <ThreeDIcon />
            </IconButton>
          </Tooltip>
        )}
      </Paper>
    </>
  );
}
