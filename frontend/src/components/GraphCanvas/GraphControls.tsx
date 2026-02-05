import {
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import {
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';
import type { Core } from 'cytoscape';

interface GraphControlsProps {
  cyRef: React.RefObject<Core | null>;
}

export function GraphControls({ cyRef }: GraphControlsProps) {
  const handleZoomIn = () => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.zoom(cy.zoom() * 1.2);
      cy.center();
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.zoom(cy.zoom() * 0.8);
      cy.center();
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
      </Paper>
    </>
  );
}
