import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Paper,
  IconButton,
  Tooltip,
  Typography,
  Fade,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Grain as DensityIcon,
} from '@mui/icons-material';
import type { RendererAPI, RendererNode } from '../../renderers/core/types';

interface MinimapProps {
  rendererRef: React.RefObject<RendererAPI | null>;
  width?: number;
  height?: number;
  viewportSize: { width: number; height: number };
}

export function Minimap({ rendererRef, width = 200, height = 150, viewportSize }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const animationRef = useRef<number | null>(null);
  const mappingRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });

  const displayWidth = isExpanded ? width * 1.5 : width;
  const displayHeight = isExpanded ? height * 1.5 : height;

  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(displayWidth * dpr));
    const nextHeight = Math.max(1, Math.round(displayHeight * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const nodes = renderer.getAllNodes();
    const edges = renderer.getAllEdges();

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((node) => {
      if (node.x === undefined || node.y === undefined) return;
      const radius = node.radius ?? 0;
      minX = Math.min(minX, node.x - radius);
      minY = Math.min(minY, node.y - radius);
      maxX = Math.max(maxX, node.x + radius);
      maxY = Math.max(maxY, node.y + radius);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return;
    }

    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const padding = 12;
    const scale = Math.min(
      (displayWidth - padding * 2) / worldWidth,
      (displayHeight - padding * 2) / worldHeight
    );

    const offsetX = (displayWidth - worldWidth * scale) / 2 - minX * scale;
    const offsetY = (displayHeight - worldHeight * scale) / 2 - minY * scale;
    mappingRef.current = { scale, offsetX, offsetY };

    ctx.strokeStyle = showDensity ? 'rgba(15, 23, 42, 0.15)' : 'rgba(15, 23, 42, 0.25)';
    ctx.lineWidth = 1;

    edges.forEach((edge) => {
      const source = renderer.getNodeById(edge.source);
      const target = renderer.getNodeById(edge.target);
      if (!source || !target) return;
      if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) return;
      const startX = source.x * scale + offsetX;
      const startY = source.y * scale + offsetY;
      const endX = target.x * scale + offsetX;
      const endY = target.y * scale + offsetY;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    });

    nodes.forEach((node: RendererNode) => {
      if (node.x === undefined || node.y === undefined) return;
      const x = node.x * scale + offsetX;
      const y = node.y * scale + offsetY;
      const baseSize = showDensity ? 2 + Math.min(node.degree, 10) * 0.3 : 3;
      const radius = Math.max(2, Math.min(8, baseSize));

      if (showDensity) {
        const intensity = Math.min(node.degree / 10, 1);
        ctx.fillStyle = `hsl(${220 - intensity * 120}, 70%, ${45 + intensity * 25}%)`;
      } else {
        ctx.fillStyle = node.color || '#90caf9';
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    const transform = renderer.getTransform();
    const viewLeft = -transform.x / transform.k;
    const viewTop = -transform.y / transform.k;
    const viewRight = (viewportSize.width - transform.x) / transform.k;
    const viewBottom = (viewportSize.height - transform.y) / transform.k;

    const rectX = viewLeft * scale + offsetX;
    const rectY = viewTop * scale + offsetY;
    const rectWidth = (viewRight - viewLeft) * scale;
    const rectHeight = (viewBottom - viewTop) * scale;

    ctx.strokeStyle = 'rgba(25, 118, 210, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
    ctx.fillStyle = 'rgba(25, 118, 210, 0.15)';
    ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
  }, [displayHeight, displayWidth, rendererRef, showDensity, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!isVisible) return;

    const loop = () => {
      drawMinimap();
      animationRef.current = window.requestAnimationFrame(loop);
    };

    loop();

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawMinimap, isVisible]);

  const handleMinimapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const { scale, offsetX, offsetY } = mappingRef.current;
    if (scale === 0) return;

    const worldX = (clickX - offsetX) / scale;
    const worldY = (clickY - offsetY) / scale;
    renderer.panTo(worldX, worldY);
  };

  if (!isVisible) {
    return (
      <Tooltip title="显示小地图">
        <IconButton
          sx={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 1000,
            backgroundColor: 'background.paper',
            boxShadow: 2,
            '&:hover': {
              backgroundColor: 'background.paper',
            },
          }}
          onClick={() => setIsVisible(true)}
        >
          <VisibilityIcon />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Fade in={isVisible}>
      <Paper
        elevation={4}
        sx={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          width: displayWidth,
          height: displayHeight + 40,
          zIndex: 1000,
          overflow: 'hidden',
          transition: 'all 0.3s ease',
          '@media (max-width: 600px)': {
            bottom: 80,
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 0.5,
            backgroundColor: 'background.default',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            小地图
          </Typography>

          <Box>
            <Tooltip title={showDensity ? '普通视图' : '密度视图'}>
              <IconButton
                size="small"
                onClick={() => setShowDensity(!showDensity)}
                color={showDensity ? 'primary' : 'default'}
              >
                <DensityIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={isExpanded ? '缩小' : '放大'}>
              <IconButton size="small" onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? <ZoomOutIcon fontSize="small" /> : <ZoomInIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            <Tooltip title="隐藏小地图">
              <IconButton size="small" onClick={() => setIsVisible(false)}>
                <VisibilityOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Box
          sx={{
            position: 'relative',
            width: displayWidth,
            height: displayHeight,
            backgroundColor: 'background.paper',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              cursor: 'pointer',
              display: 'block',
            }}
            onClick={handleMinimapClick}
          />
        </Box>
      </Paper>
    </Fade>
  );
}
