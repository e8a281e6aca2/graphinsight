import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
} from 'd3-force';
import type {
  RendererAPI,
  RendererActiveElement,
  RendererData,
  RendererEdge,
  RendererEventHandlers,
  RendererNode,
  RendererOptions,
} from '../core/types';
import { generateVideoThumbnail } from '../../utils/videoThumbnail';

type LinkDatum = RendererEdge & {
  source: RendererNode | string;
  target: RendererNode | string;
};

type FilterState = {
  nodeTypes: string[];
  edgeTypes: string[];
  hiddenNodeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
};

const NODE_LABEL_ZOOM = 0.5;
const EDGE_LABEL_ZOOM = 0.8;
const DEFAULT_EDGE_COLOR = 'rgba(15, 23, 42, 0.28)';
const DEFAULT_NODE_STROKE = '#0f172a';
const ACTIVE_COLOR = '#ff4081';
const HIGHLIGHT_COLOR = '#ffd700';
const PATH_COLOR = '#ff6b6b';
const FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function createRenderer(
  canvas: HTMLCanvasElement,
  handlers: RendererEventHandlers = {},
  options: RendererOptions = {}
): RendererAPI {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }

  let width = (options.width ?? canvas.clientWidth) || 1;
  let height = (options.height ?? canvas.clientHeight) || 1;
  let dpr = window.devicePixelRatio || 1;

  let transform: ZoomTransform = zoomIdentity;
  const minZoom = options.minZoom ?? 0.25;
  const maxZoom = options.maxZoom ?? 3;
  const initialZoom = options.initialZoom ?? 0.5;

  let nodes: RendererNode[] = [];
  let edges: LinkDatum[] = [];
  let nodeById = new Map<string, RendererNode>();
  let edgeById = new Map<string, LinkDatum>();
  let visibleNodeIds = new Set<string>();
  let visibleEdgeIds = new Set<string>();
  let highlightedNodeIds = new Set<string>();
  let highlightedEdgeIds = new Set<string>();
  let activeHighlightNodeIds = new Set<string>();
  let activeHighlightEdgeIds = new Set<string>();
  let searchHighlightNodeIds = new Set<string>();
  let searchHighlightEdgeIds = new Set<string>();
  let pathHighlightNodeIds = new Set<string>();
  let pathHighlightEdgeIds = new Set<string>();
  let activeElement: RendererActiveElement | null = null;
  let filterState: FilterState = {
    nodeTypes: [],
    edgeTypes: [],
    hiddenNodeIds: new Set(),
    hiddenEdgeIds: new Set(),
  };

  let simulation: Simulation<RendererNode, LinkDatum> | null = null;
  const linkForce = forceLink<RendererNode, LinkDatum>()
    .id((d) => d.id)
    .distance(120)
    .strength(0.3);

  let rafId: number | null = null;
  let needsRender = false;

  const imageCache = new Map<string, HTMLImageElement>();
  const baseRadiusById = new Map<string, number>();
  let nodeSizeOverrides: Map<string, number> | null = null;

  let isPointerDown = false;
  let dragNode: RendererNode | null = null;
  let dragMoved = false;
  let suppressClick = false;
  let lastHover: { type: 'node' | 'edge' | 'background'; id?: string } | null = null;

  const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([minZoom, maxZoom])
    .filter((event) => {
      if (event.type === 'dblclick') return false;
      if ((event as MouseEvent).button === 2) return false;
      return !dragNode;
    })
    .on('zoom', (event) => {
      transform = event.transform;
      handlers.onTransform?.({ x: transform.x, y: transform.y, k: transform.k });
      scheduleRender();
    });

  function updateCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    let nextWidth = (options.width ?? rect.width ?? canvas.clientWidth) || 0;
    let nextHeight = (options.height ?? rect.height ?? canvas.clientHeight) || 0;

    if ((!nextWidth || !nextHeight) && canvas.parentElement) {
      const parentRect = canvas.parentElement.getBoundingClientRect();
      nextWidth = nextWidth || parentRect.width;
      nextHeight = nextHeight || parentRect.height;
    }

    if (!nextWidth || !nextHeight) {
      return;
    }

    width = nextWidth;
    height = nextHeight;
    dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    if (simulation) {
      simulation.force('center', forceCenter(width / 2, height / 2));
      simulation.alpha(0.2).restart();
    }

    scheduleRender();
  }

  function scheduleRender() {
    if (rafId !== null) {
      needsRender = true;
      return;
    }
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      if (needsRender) {
        needsRender = false;
      }
      render();
    });
  }

  function getPointerPosition(event: MouseEvent | PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function worldToScreen(x: number, y: number) {
    return {
      x: transform.x + x * transform.k,
      y: transform.y + y * transform.k,
    };
  }

  function screenToWorld(x: number, y: number) {
    return {
      x: (x - transform.x) / transform.k,
      y: (y - transform.y) / transform.k,
    };
  }

  function loadImage(url: string) {
    if (!url) return;
    if (imageCache.has(url)) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => scheduleRender();
    img.onerror = () => {
      imageCache.delete(url);
      scheduleRender();
    };
    img.src = url;
    imageCache.set(url, img);
  }

  function preloadMedia(nextNodes: RendererNode[]) {
    nextNodes.forEach((node) => {
      if (node.isVideo && node.video && !node.videoThumbnailUrl) {
        generateVideoThumbnail(node.video)
          .then((thumbnail) => {
            node.videoThumbnailUrl = thumbnail;
            loadImage(thumbnail);
            scheduleRender();
          })
          .catch(() => {
            scheduleRender();
          });
      }

      const imageUrl = node.videoThumbnailUrl || node.image;
      if (imageUrl) {
        loadImage(imageUrl);
      }
    });
  }

  function applyFilter() {
    visibleNodeIds = new Set<string>();
    visibleEdgeIds = new Set<string>();

    const hasNodeFilter = filterState.nodeTypes.length > 0;
    const hasEdgeFilter = filterState.edgeTypes.length > 0;

    nodes.forEach((node) => {
      if (filterState.hiddenNodeIds.has(node.id)) return;
      if (hasNodeFilter && !filterState.nodeTypes.includes(node.type)) return;
      visibleNodeIds.add(node.id);
    });

    edges.forEach((edge) => {
      if (filterState.hiddenEdgeIds.has(edge.id)) return;
      if (hasEdgeFilter && !filterState.edgeTypes.includes(edge.type)) return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) return;
      visibleEdgeIds.add(edge.id);
    });
  }

  function updateHighlights() {
    activeHighlightNodeIds = new Set<string>();
    activeHighlightEdgeIds = new Set<string>();

    if (activeElement) {
      if (activeElement.type === 'node') {
        const node = nodeById.get(activeElement.id);
        if (node) {
          activeHighlightNodeIds.add(node.id);
          node.neighbors.forEach((id) => activeHighlightNodeIds.add(id));
          edges.forEach((edge) => {
            const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
            if (sourceId === node.id || targetId === node.id) {
              activeHighlightEdgeIds.add(edge.id);
            }
          });
        }
      }

      if (activeElement.type === 'edge') {
        const edge = edgeById.get(activeElement.id);
        if (edge) {
          activeHighlightEdgeIds.add(edge.id);
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          activeHighlightNodeIds.add(sourceId);
          activeHighlightNodeIds.add(targetId);
        }
      }
    }

    highlightedNodeIds = new Set<string>([
      ...activeHighlightNodeIds,
      ...searchHighlightNodeIds,
      ...pathHighlightNodeIds,
    ]);
    highlightedEdgeIds = new Set<string>([
      ...activeHighlightEdgeIds,
      ...searchHighlightEdgeIds,
      ...pathHighlightEdgeIds,
    ]);
  }

  function updateSimulation() {
    if (!simulation) {
      simulation = forceSimulation<RendererNode>()
        .force('link', linkForce)
        .force('charge', forceManyBody().strength(-280))
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide<RendererNode>().radius((d) => d.radius + 12))
        .on('tick', scheduleRender);
    }

    const simNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    const simEdges = edges.filter((edge) => visibleEdgeIds.has(edge.id));

    if (simNodes.length === 0) {
      simulation.stop();
      scheduleRender();
      return;
    }

    simulation.nodes(simNodes);
    linkForce.links(simEdges);
    simulation.alpha(1).restart();
  }

  function getEdgeNodes(edge: LinkDatum) {
    const source = typeof edge.source === 'string' ? nodeById.get(edge.source) : edge.source;
    const target = typeof edge.target === 'string' ? nodeById.get(edge.target) : edge.target;
    return { source, target };
  }

  function findNode(screenX: number, screenY: number) {
    const { x, y } = screenToWorld(screenX, screenY);
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (!visibleNodeIds.has(node.id)) continue;
      if (node.x === undefined || node.y === undefined) continue;
      const dx = x - node.x;
      const dy = y - node.y;
      const radius = node.radius || 0;
      if (dx * dx + dy * dy <= radius * radius) {
        return node;
      }
    }
    return null;
  }

  function distanceToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
      return Math.hypot(px - x1, py - y1);
    }
    const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    const sx = x1 + clamped * dx;
    const sy = y1 + clamped * dy;
    return Math.hypot(px - sx, py - sy);
  }

  function findEdge(screenX: number, screenY: number) {
    const threshold = 5;
    for (let i = edges.length - 1; i >= 0; i -= 1) {
      const edge = edges[i];
      if (!visibleEdgeIds.has(edge.id)) continue;
      const { source, target } = getEdgeNodes(edge);
      if (!source || !target) continue;
      if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;
      const sourceScreen = worldToScreen(source.x, source.y);
      const targetScreen = worldToScreen(target.x, target.y);
      const distance = distanceToSegment(
        screenX,
        screenY,
        sourceScreen.x,
        sourceScreen.y,
        targetScreen.x,
        targetScreen.y
      );
      if (distance <= threshold) {
        return edge;
      }
    }
    return null;
  }

  function drawArrow(
    context: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    const arrowLength = 8;
    const arrowWidth = 5;

    const tipX = x2;
    const tipY = y2;
    const leftX = tipX - arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle);
    const leftY = tipY - arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle);
    const rightX = tipX - arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle);
    const rightY = tipY - arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle);

    context.fillStyle = color;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(leftX, leftY);
    context.lineTo(rightX, rightY);
    context.closePath();
    context.fill();
  }

  function drawEdges(context: CanvasRenderingContext2D, currentTransform: ZoomTransform) {
    const hasHighlight = highlightedNodeIds.size > 0 || highlightedEdgeIds.size > 0;

    edges.forEach((edge) => {
      if (!visibleEdgeIds.has(edge.id)) return;
      const { source, target } = getEdgeNodes(edge);
      if (!source || !target) return;
      if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const sourceOffset = source.radius ?? 0;
      const targetOffset = (target.radius ?? 0) + 6;

      const startX = source.x + (dx / distance) * sourceOffset;
      const startY = source.y + (dy / distance) * sourceOffset;
      const endX = target.x - (dx / distance) * targetOffset;
      const endY = target.y - (dy / distance) * targetOffset;

      const isActiveEdge = activeElement?.type === 'edge' && activeElement.id === edge.id;
      const isPathHighlighted = pathHighlightEdgeIds.has(edge.id);
      const isSearchHighlighted = searchHighlightEdgeIds.has(edge.id);
      const isActiveRelated = activeHighlightEdgeIds.has(edge.id);
      const isEmphasized = isActiveEdge || isPathHighlighted || isSearchHighlighted || isActiveRelated;
      const baseColor = edge.color || DEFAULT_EDGE_COLOR;
      const strokeColor = isActiveEdge
        ? ACTIVE_COLOR
        : isPathHighlighted
          ? PATH_COLOR
          : isSearchHighlighted
            ? HIGHLIGHT_COLOR
            : isActiveRelated
              ? HIGHLIGHT_COLOR
              : baseColor;
      const lineWidth = isActiveEdge ? 3 : isPathHighlighted ? 2.5 : isSearchHighlighted ? 2 : isActiveRelated ? 2 : 1.2;

      context.globalAlpha = hasHighlight && !isEmphasized ? 0.15 : 1;
      context.strokeStyle = strokeColor;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();

      drawArrow(context, startX, startY, endX, endY, strokeColor);

      if (currentTransform.k > EDGE_LABEL_ZOOM && edge.predicate) {
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const label = edge.predicate;
        context.save();
        context.font = `12px ${FONT_FAMILY}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const metrics = context.measureText(label);
        const padding = 4;
        const rectWidth = metrics.width + padding * 2;
        const rectHeight = 16;
        context.fillStyle = 'rgba(255, 255, 255, 0.75)';
        context.strokeStyle = 'rgba(15, 23, 42, 0.12)';
        context.lineWidth = 1;
        context.beginPath();
        context.rect(midX - rectWidth / 2, midY - rectHeight / 2, rectWidth, rectHeight);
        context.fill();
        context.stroke();
        context.fillStyle = '#475569';
        context.fillText(label, midX, midY + 0.5);
        context.restore();
      }
    });

    context.globalAlpha = 1;
  }

  function drawNodeImage(
    context: CanvasRenderingContext2D,
    node: RendererNode,
    x: number,
    y: number,
    radius: number
  ) {
    const imageUrl = node.videoThumbnailUrl || node.image;
    if (!imageUrl) return false;
    const img = imageCache.get(imageUrl);
    if (!img || !img.complete || img.naturalWidth === 0) return false;

    const size = radius * 2;
    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.clip();

    const imageAspect = img.naturalWidth / img.naturalHeight;
    let drawWidth = size;
    let drawHeight = size;
    if (imageAspect > 1) {
      drawWidth = size * imageAspect;
      drawHeight = size;
    } else {
      drawWidth = size;
      drawHeight = size / imageAspect;
    }

    context.drawImage(img, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    return true;
  }

  function drawVideoOverlay(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    context.save();
    context.fillStyle = 'rgba(0, 0, 0, 0.25)';
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.beginPath();
    context.arc(x, y, radius * 0.4, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#1976d2';
    context.beginPath();
    context.moveTo(x - radius * 0.12, y - radius * 0.18);
    context.lineTo(x - radius * 0.12, y + radius * 0.18);
    context.lineTo(x + radius * 0.2, y);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawNodes(context: CanvasRenderingContext2D, currentTransform: ZoomTransform) {
    const hasHighlight = highlightedNodeIds.size > 0 || highlightedEdgeIds.size > 0;

    nodes.forEach((node) => {
      if (!visibleNodeIds.has(node.id)) return;
      if (node.x === undefined || node.y === undefined) return;

      const isActiveNode = activeElement?.type === 'node' && activeElement.id === node.id;
      const isPathHighlighted = pathHighlightNodeIds.has(node.id);
      const isSearchHighlighted = searchHighlightNodeIds.has(node.id);
      const isActiveRelated = activeHighlightNodeIds.has(node.id);
      const isEmphasized = isActiveNode || isPathHighlighted || isSearchHighlighted || isActiveRelated;
      const radius = node.radius ?? 24;

      context.globalAlpha = hasHighlight && !isEmphasized ? 0.2 : 1;

      context.fillStyle = node.color;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.fill();

      const hasImage = drawNodeImage(context, node, node.x, node.y, radius);
      if (node.isVideo) {
        drawVideoOverlay(context, node.x, node.y, radius);
      }

      context.strokeStyle = isActiveNode
        ? ACTIVE_COLOR
        : isPathHighlighted
          ? PATH_COLOR
          : isSearchHighlighted
            ? HIGHLIGHT_COLOR
            : isActiveRelated
              ? HIGHLIGHT_COLOR
              : DEFAULT_NODE_STROKE;
      context.lineWidth = isActiveNode ? 3 : isPathHighlighted ? 2.5 : isSearchHighlighted ? 2 : isActiveRelated ? 2 : 1;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.stroke();

      if (currentTransform.k > NODE_LABEL_ZOOM && node.label) {
        context.save();
        context.font = `12px ${FONT_FAMILY}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = hasImage ? '#ffffff' : '#0f172a';
        context.fillText(node.label, node.x, node.y);
        context.restore();
      }
    });

    context.globalAlpha = 1;
  }

  function renderToContext(
    context: CanvasRenderingContext2D,
    params: { width: number; height: number; dpr: number; background?: string; transform: ZoomTransform }
  ) {
    context.setTransform(params.dpr, 0, 0, params.dpr, 0, 0);
    context.clearRect(0, 0, params.width, params.height);
    if (params.background) {
      context.fillStyle = params.background;
      context.fillRect(0, 0, params.width, params.height);
    }
    context.save();
    context.translate(params.transform.x, params.transform.y);
    context.scale(params.transform.k, params.transform.k);
    drawEdges(context, params.transform);
    drawNodes(context, params.transform);
    context.restore();
  }

  function render() {
    renderToContext(ctx, { width, height, dpr, transform });
  }

  function updateData(data: RendererData) {
    const previousNodes = nodeById;
    baseRadiusById.clear();
    const nextNodes = data.nodes.map((node) => {
      const previous = previousNodes.get(node.id);
      const baseRadius = node.radius ?? 24;
      baseRadiusById.set(node.id, baseRadius);
      const overrideRadius = nodeSizeOverrides?.get(node.id);
      const next: RendererNode = { ...node, radius: overrideRadius ?? baseRadius };
      if (previous) {
        next.x = previous.x;
        next.y = previous.y;
        next.fx = previous.fx;
        next.fy = previous.fy;
      }
      return next;
    });

    const nextNodeById = new Map<string, RendererNode>();
    nextNodes.forEach((node) => nextNodeById.set(node.id, node));

    const nextEdges: LinkDatum[] = data.edges.map((edge) => ({
      ...edge,
      source: edge.source,
      target: edge.target,
    }));

    nodes = nextNodes;
    edges = nextEdges;
    nodeById = nextNodeById;
    edgeById = new Map(edges.map((edge) => [edge.id, edge]));

    preloadMedia(nodes);
    applyFilter();
    updateHighlights();
    updateSimulation();
    scheduleRender();
  }

  function setActiveElement(nextActive: RendererActiveElement | null) {
    activeElement = nextActive;
    updateHighlights();
    scheduleRender();
  }

  function setSearchHighlight(payload: { nodeIds?: string[]; edgeIds?: string[] }) {
    searchHighlightNodeIds = new Set(payload.nodeIds ?? []);
    searchHighlightEdgeIds = new Set(payload.edgeIds ?? []);
    updateHighlights();
    scheduleRender();
  }

  function clearSearchHighlight() {
    searchHighlightNodeIds = new Set();
    searchHighlightEdgeIds = new Set();
    updateHighlights();
    scheduleRender();
  }

  function setPathHighlight(payload: { nodeIds?: string[]; edgeIds?: string[] }) {
    pathHighlightNodeIds = new Set(payload.nodeIds ?? []);
    pathHighlightEdgeIds = new Set(payload.edgeIds ?? []);
    updateHighlights();
    scheduleRender();
  }

  function clearPathHighlight() {
    pathHighlightNodeIds = new Set();
    pathHighlightEdgeIds = new Set();
    updateHighlights();
    scheduleRender();
  }

  function setNodeSizeOverrides(overrides: Record<string, number> | Map<string, number> | null) {
    if (!overrides) {
      nodeSizeOverrides = null;
      nodes.forEach((node) => {
        const baseRadius = baseRadiusById.get(node.id);
        if (baseRadius !== undefined) {
          node.radius = baseRadius;
        }
      });
    } else if (overrides instanceof Map) {
      nodeSizeOverrides = new Map(overrides);
      nodes.forEach((node) => {
        const baseRadius = baseRadiusById.get(node.id) ?? node.radius ?? 24;
        node.radius = overrides.get(node.id) ?? baseRadius;
      });
    } else {
      nodeSizeOverrides = new Map(Object.entries(overrides));
      nodes.forEach((node) => {
        const baseRadius = baseRadiusById.get(node.id) ?? node.radius ?? 24;
        node.radius = nodeSizeOverrides.get(node.id) ?? baseRadius;
      });
    }
    updateSimulation();
    scheduleRender();
  }

  function setFilter(filter: {
    nodeTypes?: string[];
    edgeTypes?: string[];
    hiddenNodeIds?: Set<string>;
    hiddenEdgeIds?: Set<string>;
  }) {
    filterState = {
      nodeTypes: filter.nodeTypes ?? [],
      edgeTypes: filter.edgeTypes ?? [],
      hiddenNodeIds: filter.hiddenNodeIds ?? new Set(),
      hiddenEdgeIds: filter.hiddenEdgeIds ?? new Set(),
    };
    applyFilter();
    updateSimulation();
    scheduleRender();
  }

  function zoomBy(factor: number) {
    select(canvas).call(zoomBehavior.scaleBy as any, factor);
  }

  function zoomTo(k: number) {
    const clamped = Math.max(minZoom, Math.min(maxZoom, k));
    select(canvas).call(zoomBehavior.scaleTo as any, clamped);
  }

  function panTo(x: number, y: number) {
    select(canvas).call(zoomBehavior.translateTo as any, x, y);
  }

  function center() {
    const targetNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    if (targetNodes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    targetNodes.forEach((node) => {
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

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    panTo(centerX, centerY);
  }

  function fitTo(nodeIds?: string[], padding = 40) {
    const targetNodes = nodeIds && nodeIds.length > 0
      ? nodeIds.map((id) => nodeById.get(id)).filter(Boolean) as RendererNode[]
      : nodes.filter((node) => visibleNodeIds.has(node.id));

    if (targetNodes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    targetNodes.forEach((node) => {
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

    const boundsWidth = Math.max(1, maxX - minX);
    const boundsHeight = Math.max(1, maxY - minY);
    const scale = Math.min(
      (width - padding * 2) / boundsWidth,
      (height - padding * 2) / boundsHeight
    );
    const clampedScale = Math.max(minZoom, Math.min(maxZoom, scale));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const nextTransform = zoomIdentity
      .translate(width / 2 - centerX * clampedScale, height / 2 - centerY * clampedScale)
      .scale(clampedScale);
    select(canvas).call(zoomBehavior.transform as any, nextTransform);
  }

  function getTransform() {
    return { x: transform.x, y: transform.y, k: transform.k };
  }

  function getViewportSize() {
    return { width, height };
  }

  function getNodeById(id: string) {
    return nodeById.get(id);
  }

  function getEdgeById(id: string) {
    const edge = edgeById.get(id);
    if (!edge) return undefined;
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    return { ...edge, source: sourceId, target: targetId };
  }

  function getNeighbors(id: string) {
    const node = nodeById.get(id);
    return node ? node.neighbors : [];
  }

  function getAllNodes() {
    return nodes;
  }

  function getAllEdges() {
    return edges.map((edge) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      return { ...edge, source: sourceId, target: targetId };
    });
  }

  async function exportPNG(options?: { background?: string; scale?: number }) {
    const exportScale = options?.scale ?? 1;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(1, Math.round(width * dpr * exportScale));
    exportCanvas.height = Math.max(1, Math.round(height * dpr * exportScale));
    const exportContext = exportCanvas.getContext('2d');
    if (!exportContext) {
      throw new Error('Export canvas context is not available');
    }

    renderToContext(exportContext, {
      width,
      height,
      dpr: dpr * exportScale,
      background: options?.background,
      transform,
    });

    return new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to export PNG'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  function sanitizeId(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async function exportSVG(options?: { background?: string }) {
    const svgWidth = width;
    const svgHeight = height;
    const hasHighlight = highlightedNodeIds.size > 0 || highlightedEdgeIds.size > 0;
    const defs: string[] = [];
    const nodesSvg: string[] = [];
    const edgesSvg: string[] = [];
    const labelsSvg: string[] = [];

    edges.forEach((edge) => {
      if (!visibleEdgeIds.has(edge.id)) return;
      const { source, target } = getEdgeNodes(edge);
      if (!source || !target) return;
      if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const sourceOffset = source.radius ?? 0;
      const targetOffset = (target.radius ?? 0) + 6;
      const startX = source.x + (dx / distance) * sourceOffset;
      const startY = source.y + (dy / distance) * sourceOffset;
      const endX = target.x - (dx / distance) * targetOffset;
      const endY = target.y - (dy / distance) * targetOffset;

      const startScreen = worldToScreen(startX, startY);
      const endScreen = worldToScreen(endX, endY);

      const isActiveEdge = activeElement?.type === 'edge' && activeElement.id === edge.id;
      const isPathHighlighted = pathHighlightEdgeIds.has(edge.id);
      const isSearchHighlighted = searchHighlightEdgeIds.has(edge.id);
      const isActiveRelated = activeHighlightEdgeIds.has(edge.id);
      const isEmphasized = isActiveEdge || isPathHighlighted || isSearchHighlighted || isActiveRelated;
      const baseColor = edge.color || DEFAULT_EDGE_COLOR;
      const strokeColor = isActiveEdge
        ? ACTIVE_COLOR
        : isPathHighlighted
          ? PATH_COLOR
          : isSearchHighlighted
            ? HIGHLIGHT_COLOR
            : isActiveRelated
              ? HIGHLIGHT_COLOR
              : baseColor;
      const strokeWidth = (isActiveEdge ? 3 : isPathHighlighted ? 2.5 : isSearchHighlighted ? 2 : isActiveRelated ? 2 : 1.2) * transform.k;
      const opacity = hasHighlight && !isEmphasized ? 0.15 : 1;

      edgesSvg.push(
        `<line x1="${startScreen.x.toFixed(2)}" y1="${startScreen.y.toFixed(2)}" x2="${endScreen.x.toFixed(2)}" y2="${endScreen.y.toFixed(2)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
      );

      const angle = Math.atan2(endScreen.y - startScreen.y, endScreen.x - startScreen.x);
      const arrowLength = 8 * transform.k;
      const arrowWidth = 5 * transform.k;
      const tipX = endScreen.x;
      const tipY = endScreen.y;
      const leftX = tipX - arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle);
      const leftY = tipY - arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle);
      const rightX = tipX - arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle);
      const rightY = tipY - arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle);

      edgesSvg.push(
        `<path d="M ${tipX.toFixed(2)} ${tipY.toFixed(2)} L ${leftX.toFixed(2)} ${leftY.toFixed(2)} L ${rightX.toFixed(2)} ${rightY.toFixed(2)} Z" fill="${strokeColor}" opacity="${opacity}"/>`
      );

      if (transform.k > EDGE_LABEL_ZOOM && edge.predicate) {
        const midX = (startScreen.x + endScreen.x) / 2;
        const midY = (startScreen.y + endScreen.y) / 2;
        const label = escapeXml(edge.predicate);
        const fontSize = 12 * transform.k;
        labelsSvg.push(
          `<text x="${midX.toFixed(2)}" y="${midY.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize.toFixed(2)}" font-family="${FONT_FAMILY}" fill="#475569">${label}</text>`
        );
      }
    });

    nodes.forEach((node) => {
      if (!visibleNodeIds.has(node.id)) return;
      if (node.x === undefined || node.y === undefined) return;
      const screen = worldToScreen(node.x, node.y);
      const radius = node.radius ?? 24;

      const isActiveNode = activeElement?.type === 'node' && activeElement.id === node.id;
      const isPathHighlighted = pathHighlightNodeIds.has(node.id);
      const isSearchHighlighted = searchHighlightNodeIds.has(node.id);
      const isActiveRelated = activeHighlightNodeIds.has(node.id);
      const isEmphasized = isActiveNode || isPathHighlighted || isSearchHighlighted || isActiveRelated;
      const opacity = hasHighlight && !isEmphasized ? 0.2 : 1;
      const stroke = isActiveNode
        ? ACTIVE_COLOR
        : isPathHighlighted
          ? PATH_COLOR
          : isSearchHighlighted
            ? HIGHLIGHT_COLOR
            : isActiveRelated
              ? HIGHLIGHT_COLOR
              : DEFAULT_NODE_STROKE;
      const strokeWidth = (isActiveNode ? 3 : isPathHighlighted ? 2.5 : isSearchHighlighted ? 2 : isActiveRelated ? 2 : 1) * transform.k;

      nodesSvg.push(
        `<circle cx="${screen.x.toFixed(2)}" cy="${screen.y.toFixed(2)}" r="${(radius * transform.k).toFixed(2)}" fill="${node.color}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
      );

      const imageUrl = node.videoThumbnailUrl || node.image;
      if (imageUrl) {
        const clipId = `clip-${sanitizeId(node.id)}`;
        defs.push(
          `<clipPath id="${clipId}"><circle cx="${screen.x.toFixed(2)}" cy="${screen.y.toFixed(2)}" r="${(radius * transform.k).toFixed(2)}"/></clipPath>`
        );
        const size = radius * 2 * transform.k;
        nodesSvg.push(
          `<image href="${imageUrl}" x="${(screen.x - size / 2).toFixed(2)}" y="${(screen.y - size / 2).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>`
        );
      }

      if (transform.k > NODE_LABEL_ZOOM && node.label) {
        const label = escapeXml(node.label);
        const fontSize = 12 * transform.k;
        labelsSvg.push(
          `<text x="${screen.x.toFixed(2)}" y="${screen.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize.toFixed(2)}" font-family="${FONT_FAMILY}" fill="#0f172a">${label}</text>`
        );
      }
    });

    const backgroundRect = options?.background
      ? `<rect width="100%" height="100%" fill="${options.background}"/>`
      : '';

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`,
      backgroundRect,
      defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
      edgesSvg.join(''),
      nodesSvg.join(''),
      labelsSvg.join(''),
      '</svg>',
    ].join('');
  }

  function handlePointerDown(event: PointerEvent) {
    isPointerDown = true;
    dragMoved = false;
    const position = getPointerPosition(event);
    const targetNode = findNode(position.x, position.y);
    if (targetNode) {
      dragNode = targetNode;
      dragNode.fx = targetNode.x ?? 0;
      dragNode.fy = targetNode.y ?? 0;
      simulation?.alphaTarget(0.3).restart();
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (dragNode) {
      const position = getPointerPosition(event);
      const world = screenToWorld(position.x, position.y);
      const distance = Math.hypot(
        (dragNode.x ?? 0) - world.x,
        (dragNode.y ?? 0) - world.y
      );
      if (distance > 2) {
        dragMoved = true;
      }
      dragNode.fx = world.x;
      dragNode.fy = world.y;
      scheduleRender();
      return;
    }

    if (isPointerDown) return;

    const position = getPointerPosition(event);
    const hoveredNode = findNode(position.x, position.y);
    const hoveredEdge = hoveredNode ? null : findEdge(position.x, position.y);
    let nextHover: { type: 'node' | 'edge' | 'background'; id?: string };

    if (hoveredNode) {
      nextHover = { type: 'node', id: hoveredNode.id };
      canvas.style.cursor = 'pointer';
    } else if (hoveredEdge) {
      nextHover = { type: 'edge', id: hoveredEdge.id };
      canvas.style.cursor = 'pointer';
    } else {
      nextHover = { type: 'background' };
      canvas.style.cursor = 'grab';
    }

    if (!lastHover || lastHover.type !== nextHover.type || lastHover.id !== nextHover.id) {
      lastHover = nextHover;
      handlers.onHover?.({
        type: nextHover.type,
        id: nextHover.id,
        x: event.clientX,
        y: event.clientY,
      });
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (dragNode) {
      dragNode.fx = null;
      dragNode.fy = null;
      simulation?.alphaTarget(0);
      canvas.releasePointerCapture(event.pointerId);
    }
    suppressClick = dragMoved;
    dragNode = null;
    isPointerDown = false;
    canvas.style.cursor = 'grab';
  }

  function handleClick(event: MouseEvent) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const position = getPointerPosition(event);
    const node = findNode(position.x, position.y);
    if (node) {
      handlers.onClick?.({ type: 'node', id: node.id, x: event.clientX, y: event.clientY });
      return;
    }
    const edge = findEdge(position.x, position.y);
    if (edge) {
      handlers.onClick?.({ type: 'edge', id: edge.id, x: event.clientX, y: event.clientY });
      return;
    }
    handlers.onClick?.({ type: 'background', x: event.clientX, y: event.clientY });
  }

  function handleDoubleClick(event: MouseEvent) {
    const position = getPointerPosition(event);
    const node = findNode(position.x, position.y);
    if (node) {
      handlers.onDoubleClick?.({ type: 'node', id: node.id });
      return;
    }
    handlers.onDoubleClick?.({ type: 'background' });
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    const position = getPointerPosition(event);
    const node = findNode(position.x, position.y);
    if (node) {
      handlers.onContextMenu?.({ type: 'node', id: node.id, x: event.clientX, y: event.clientY });
      return;
    }
    const edge = findEdge(position.x, position.y);
    if (edge) {
      handlers.onContextMenu?.({ type: 'edge', id: edge.id, x: event.clientX, y: event.clientY });
      return;
    }
    handlers.onContextMenu?.({ type: 'background', x: event.clientX, y: event.clientY });
  }

  function handlePointerLeave() {
    lastHover = null;
    handlers.onHover?.({ type: 'background', x: 0, y: 0 });
  }

  updateCanvasSize();
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('dblclick', handleDoubleClick);
  canvas.addEventListener('contextmenu', handleContextMenu);

  select(canvas).call(zoomBehavior as any);
  select(canvas).on('dblclick.zoom', null);
  if (initialZoom !== 1) {
    select(canvas).call(zoomBehavior.scaleTo as any, initialZoom);
  }

  const resizeObserver = new ResizeObserver(() => {
    updateCanvasSize();
  });
  resizeObserver.observe(canvas);
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement);
  }

  return {
    updateData,
    setActiveElement,
    setSearchHighlight,
    clearSearchHighlight,
    setPathHighlight,
    clearPathHighlight,
    setFilter,
    setNodeSizeOverrides,
    zoomBy,
    zoomTo,
    panTo,
    center,
    fitTo,
    getTransform,
    getViewportSize,
    getNodeById,
    getEdgeById,
    getNeighbors,
    getAllNodes,
    getAllEdges,
    exportPNG,
    exportSVG,
    destroy: () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      select(canvas).on('.zoom', null);
      simulation?.stop();
      imageCache.clear();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    },
  };
}
