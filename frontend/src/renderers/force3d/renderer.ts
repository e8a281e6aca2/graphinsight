import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import SpriteText from 'three-spritetext';
import type {
  LayoutConfig,
  RendererAPI,
  RendererActiveElement,
  RendererData,
  RendererEdge,
  RendererEventHandlers,
  RendererNode,
  RendererOptions,
} from '../core/types';
import { FORCE3D_PRESETS } from './stylePresets';

type GraphNode = RendererNode & {
  x?: number;
  y?: number;
  z?: number;
};

type GraphLink = RendererEdge & {
  sourceId: string;
  targetId: string;
};

type FilterState = {
  nodeTypes: string[];
  edgeTypes: string[];
  hiddenNodeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
};

type NodeVisual = {
  group: Group;
  core: Mesh<SphereGeometry, MeshLambertMaterial>;
  halo: Mesh<SphereGeometry, MeshBasicMaterial>;
  label: SpriteText;
};

type EdgeVisual = {
  line: Line<BufferGeometry, LineBasicMaterial>;
};

const MIN_RENDER_SIZE = 48;
const SIZE_RETRY_DELAY_MS = 120;
const DEFAULT_NODE_COLOR = '#64748b';
const DEFAULT_EDGE_COLOR = 'rgba(100, 116, 139, 0.32)';
const DEFAULT_RADIUS = 18;
const SMALL_LABEL_MAX = 34;
const OVERVIEW_LABEL_MAX = 14;
const INITIAL_RELAX_ITERATIONS = 90;
const MAX_REPULSION_NODES = 420;
const VIEW_FILL_FACTOR = 0.84;
const LARGE_GRAPH_NODE_THRESHOLD = 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function stableHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function toCompactText(value: unknown, maxLength = 120): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    const text = value.map((item: unknown) => toCompactText(item, 32)).filter(Boolean).join(', ');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }
  if (typeof value === 'object') return '';
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function toThreeColor(color: string) {
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\(([^)]+)\)/, (_, content) => {
      const [r, g, b] = content.split(',').map((part: string) => part.trim());
      return `rgb(${r}, ${g}, ${b})`;
    });
  }
  return color;
}

function nodeTypeKey(node: { type?: string }) {
  return String(node.type || 'unknown').trim().toLowerCase();
}

function getNodeDisplayLabel(node: GraphNode) {
  const props = node.properties || {};
  const candidates = [
    node.label,
    props.name,
    props.title,
    props.label,
    props['名称'],
    props['标题'],
    props.text,
    props.content,
    node.id,
  ];
  for (const candidate of candidates) {
    const text = toCompactText(candidate, 34);
    if (text) return text;
  }
  return node.id;
}

function sphericalSeed(id: string, radius: number): Vector3 {
  const seed = stableHash(id);
  const theta = ((seed % 4096) / 4096) * Math.PI * 2;
  const u = (((seed >> 7) % 2048) / 1024) - 1;
  const phi = Math.acos(Math.max(-1, Math.min(1, u)));
  const r = radius * (0.42 + (((seed >> 13) % 1000) / 1000) * 0.72);
  return new Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function fibonacciShell(index: number, count: number, radius: number, seedText: string) {
  if (count <= 1) return sphericalSeed(seedText, radius * 0.18);
  const seed = stableHash(seedText);
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  const y = ((index * offset) - 1) + (offset / 2);
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = ((index + (seed % 17) * 0.037) * increment) + ((seed % 360) * Math.PI / 180);
  return new Vector3(
    Math.cos(angle) * radial * radius,
    y * radius,
    Math.sin(angle) * radial * radius
  );
}

function typeDepthBias(type: string) {
  const key = type.trim().toLowerCase();
  if (key === 'document' || key === 'doc') return -120;
  if (key === 'chunk' || key === 'section' || key === 'paragraph') return -20;
  if (key.includes('fact')) return 115;
  if (key === 'entity') return 70;
  if (key === 'group') return -70;
  return 35;
}

function typeLayerBias(type: string) {
  const key = type.trim().toLowerCase();
  if (key === 'document' || key === 'doc') return -1.4;
  if (key === 'chunk' || key === 'section' || key === 'paragraph') return -0.48;
  if (key === 'entity') return 0.55;
  if (key.includes('fact')) return 1.05;
  if (key === 'group') return -0.92;
  return 0.16;
}

function desiredLinkDistance(edge: GraphLink, source?: GraphNode, target?: GraphNode) {
  const relation = `${edge.type || ''} ${edge.predicate || ''}`.toLowerCase();
  const sourceType = source ? nodeTypeKey(source) : '';
  const targetType = target ? nodeTypeKey(target) : '';
  if (relation.includes('chunk') || sourceType === 'document' || targetType === 'document') return 170;
  if (relation.includes('mention') || sourceType === 'chunk' || targetType === 'chunk') return 145;
  if (relation.includes('support') || sourceType.includes('fact') || targetType.includes('fact')) return 125;
  return 155;
}

function hasFinitePosition(node?: { x?: number; y?: number; z?: number }) {
  return Boolean(
    node
    && Number.isFinite(node.x)
    && Number.isFinite(node.y)
    && Number.isFinite(node.z)
  );
}

function setLinePoints(line: Line<BufferGeometry, LineBasicMaterial>, a: Vector3, b: Vector3) {
  line.geometry.dispose();
  line.geometry = new BufferGeometry();
  line.geometry.setAttribute('position', new Float32BufferAttribute([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
  ], 3));
}

export function createRenderer3D(
  container: HTMLDivElement,
  handlers: RendererEventHandlers = {},
  options: RendererOptions = {}
): RendererAPI {
  const style =
    (options.styleName && FORCE3D_PRESETS[options.styleName])
      ? FORCE3D_PRESETS[options.styleName]
      : FORCE3D_PRESETS.kgVivid;

  const firstPositive = (...values: Array<number | undefined>) => {
    const found = values.find((value) => Number.isFinite(value) && Number(value) > 0);
    return found ?? 1;
  };

  const readContainerSize = () => {
    const rect = container.getBoundingClientRect();
    const parentRect = container.parentElement?.getBoundingClientRect();
    const configuredWidth = Number.isFinite(options.width) && Number(options.width) > 0 ? Number(options.width) : undefined;
    const configuredHeight = Number.isFinite(options.height) && Number(options.height) > 0 ? Number(options.height) : undefined;
    return {
      width: Math.max(1, Math.round(configuredWidth ?? firstPositive(rect.width, container.clientWidth, parentRect?.width))),
      height: Math.max(1, Math.round(configuredHeight ?? firstPositive(rect.height, container.clientHeight, parentRect?.height))),
    };
  };

  const initialSize = readContainerSize();
  let width = initialSize.width;
  let height = initialSize.height;

  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.background = style.backgroundColor;

  const scene = new Scene();
  scene.background = new Color(style.backgroundColor);

  const camera = new PerspectiveCamera(52, width / height, 1, 100000);
  camera.position.set(520, 340, 760);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, style.maxPixelRatio));
  renderer.setSize(width, height);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.62;
  controls.minDistance = style.minDistance;
  controls.maxDistance = style.maxDistance;
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new AmbientLight(0xffffff, style.ambientLightIntensity));
  const directionalLight = new DirectionalLight(0xffffff, style.directionalLightIntensity);
  directionalLight.position.set(420, 720, 680);
  scene.add(directionalLight);

  const graphGroup = new Group();
  scene.add(graphGroup);

  const sphereGeometry = new SphereGeometry(1, style.nodeResolution, style.nodeResolution);
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  let nodes: GraphNode[] = [];
  let edges: GraphLink[] = [];
  let nodeById = new Map<string, GraphNode>();
  let edgeById = new Map<string, GraphLink>();
  let visibleNodeIds = new Set<string>();
  let visibleEdgeIds = new Set<string>();
  let overviewLabelNodeIds = new Set<string>();
  let globalSearchHighlight = false;
  let activeElement: RendererActiveElement | null = null;
  let searchHighlightNodeIds = new Set<string>();
  let searchHighlightEdgeIds = new Set<string>();
  let pathHighlightNodeIds = new Set<string>();
  let pathHighlightEdgeIds = new Set<string>();
  let activeNeighborNodeIds = new Set<string>();
  let activeNeighborEdgeIds = new Set<string>();
  let hoveredType: 'node' | 'edge' | 'background' = 'background';
  let hoveredId: string | null = null;
  let filterState: FilterState = {
    nodeTypes: [],
    edgeTypes: [],
    hiddenNodeIds: new Set(),
    hiddenEdgeIds: new Set(),
  };
  let nodeSizeOverrides: Map<string, number> | null = null;
  let lastClickId: string | null = null;
  let lastClickAt = 0;
  let baseDistance: number | null = null;
  let fitTimer: number | null = null;
  let sizeRetryTimer: number | null = null;
  let animationFrame: number | null = null;
  let pendingGraphApply = false;
  let destroyed = false;

  const nodeVisuals = new Map<string, NodeVisual>();
  const edgeVisuals = new Map<string, EdgeVisual>();

  function hasRenderableSize() {
    return (
      width >= MIN_RENDER_SIZE
      && height >= MIN_RENDER_SIZE
      && container.isConnected
      && container.getClientRects().length > 0
    );
  }

  function scheduleSizeRetry() {
    if (destroyed || sizeRetryTimer !== null) return;
    sizeRetryTimer = window.setTimeout(() => {
      sizeRetryTimer = null;
      updateSize();
      if (!hasRenderableSize() && pendingGraphApply) scheduleSizeRetry();
    }, SIZE_RETRY_DELAY_MS);
  }

  function getNodeBaseColor(node: GraphNode) {
    return node.color || DEFAULT_NODE_COLOR;
  }

  function getEdgeBaseColor(edge: GraphLink) {
    void edge;
    return style.edgeBaseColor || DEFAULT_EDGE_COLOR;
  }

  function isGlobalSearchHighlight() {
    return globalSearchHighlight;
  }

  function updateGlobalSearchHighlight() {
    if (visibleNodeIds.size === 0 || searchHighlightNodeIds.size < visibleNodeIds.size) {
      globalSearchHighlight = false;
      return;
    }
    for (const id of visibleNodeIds) {
      if (!searchHighlightNodeIds.has(id)) {
        globalSearchHighlight = false;
        return;
      }
    }
    if (searchHighlightEdgeIds.size === 0) {
      globalSearchHighlight = true;
      return;
    }
    if (searchHighlightEdgeIds.size < visibleEdgeIds.size) {
      globalSearchHighlight = false;
      return;
    }
    for (const id of visibleEdgeIds) {
      if (!searchHighlightEdgeIds.has(id)) {
        globalSearchHighlight = false;
        return;
      }
    }
    globalSearchHighlight = true;
  }

  function isExplicitSearchNode(id: string) {
    return searchHighlightNodeIds.has(id) && !isGlobalSearchHighlight();
  }

  function isExplicitSearchEdge(id: string) {
    return searchHighlightEdgeIds.has(id) && !isGlobalSearchHighlight();
  }

  function isNodeHighlighted(id: string) {
    return (
      activeElement?.type === 'node' && activeElement.id === id
    ) || isExplicitSearchNode(id) || pathHighlightNodeIds.has(id);
  }

  function isNodeRelated(id: string) {
    return activeNeighborNodeIds.has(id);
  }

  function isEdgeHighlighted(id: string) {
    return (
      activeElement?.type === 'edge' && activeElement.id === id
    ) || isExplicitSearchEdge(id) || pathHighlightEdgeIds.has(id) || activeNeighborEdgeIds.has(id);
  }

  function hasFocusContext() {
    return Boolean(
      activeElement
      || (searchHighlightNodeIds.size && !isGlobalSearchHighlight())
      || (searchHighlightEdgeIds.size && !isGlobalSearchHighlight())
      || pathHighlightNodeIds.size
      || pathHighlightEdgeIds.size
      || hoveredType !== 'background'
    );
  }

  function nodeRank(node: GraphNode) {
    const key = nodeTypeKey(node);
    const typeWeight = key === 'document' || key === 'doc'
      ? 5000
      : key === 'chunk' || key === 'section' || key === 'paragraph'
        ? 3000
        : key.includes('fact') || key.includes('factview')
          ? 2400
          : key === 'entity'
            ? 1700
            : 1000;
    return typeWeight + (node.degree ?? 0) * 150 + Math.min(80, getNodeDisplayLabel(node).length);
  }

  function rebuildOverviewLabels() {
    const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    if (visibleNodes.length <= SMALL_LABEL_MAX) {
      overviewLabelNodeIds = new Set(visibleNodes.map((node) => node.id));
      return;
    }
    overviewLabelNodeIds = new Set(
      [...visibleNodes]
        .sort((a, b) => nodeRank(b) - nodeRank(a) || a.id.localeCompare(b.id))
        .slice(0, Math.max(6, Math.min(OVERVIEW_LABEL_MAX, Math.round(Math.sqrt(visibleNodes.length)))))
        .map((node) => node.id)
    );
  }

  function shouldShowNodeLabel(node: GraphNode) {
    const id = node.id;
    if (hoveredType === 'node' && hoveredId === id) return true;
    if (isNodeHighlighted(id) || isExplicitSearchNode(id)) return true;
    if (visibleNodeIds.size <= SMALL_LABEL_MAX) return true;
    if (hasFocusContext()) return isNodeRelated(id) && (node.degree ?? 0) >= 2;
    return overviewLabelNodeIds.has(id);
  }

  function nodeValue(node: GraphNode) {
    const baseRadius = nodeSizeOverrides?.get(node.id) ?? node.radius ?? DEFAULT_RADIUS;
    const active = activeElement?.type === 'node' && activeElement.id === node.id;
    const highlighted = isNodeHighlighted(node.id);
    const related = isNodeRelated(node.id);
    const scale = active ? 1.55 : highlighted ? 1.32 : related ? 1.14 : 1;
    return Math.max(4, (baseRadius * style.nodeScale * scale) / 3.2);
  }

  function getSpatialTargets(layoutNodes: GraphNode[]) {
    const groups = new Map<string, GraphNode[]>();
    layoutNodes.forEach((node) => {
      const key = nodeTypeKey(node);
      groups.set(key, [...(groups.get(key) ?? []), node]);
    });

    const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const targets = new Map<string, Vector3>();
    const graphRadius = Math.max(260, Math.sqrt(layoutNodes.length) * style.linkDistance * 0.64);
    const groupOrbit = Math.max(160, graphRadius * 0.46);
    const depthScale = Math.max(150, graphRadius * 0.34);

    sortedGroups.forEach(([type, groupNodes], groupIndex) => {
      const angle = groupIndex * GOLDEN_ANGLE;
      const layer = typeLayerBias(type);
      const orbitScale = 0.34 + Math.sqrt((groupIndex + 1) / Math.max(1, sortedGroups.length)) * 0.72;
      const groupCenter = new Vector3(
        Math.cos(angle) * groupOrbit * orbitScale,
        Math.sin(angle) * groupOrbit * 0.64 * orbitScale,
        layer * depthScale
      );
      const sortedNodes = [...groupNodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0) || a.id.localeCompare(b.id));
      const shellRadius = Math.max(70, Math.min(graphRadius * 0.42, Math.sqrt(sortedNodes.length) * style.linkDistance * 0.5));

      sortedNodes.forEach((node, index) => {
        const local = fibonacciShell(index, sortedNodes.length, shellRadius, `${type}:${node.id}`);
        targets.set(node.id, groupCenter.clone().add(local));
      });
    });

    return targets;
  }

  function applySpatialTargets(layoutNodes: GraphNode[], strength = 1) {
    const targets = getSpatialTargets(layoutNodes);
    layoutNodes.forEach((node) => {
      const target = targets.get(node.id);
      if (!target) return;
      node.x = (node.x ?? 0) + (target.x - (node.x ?? 0)) * strength;
      node.y = (node.y ?? 0) + (target.y - (node.y ?? 0)) * strength;
      node.z = (node.z ?? 0) + (target.z - (node.z ?? 0)) * strength;
    });
  }

  function normalizeNodes(data: RendererData): GraphNode[] {
    const previous = nodeById;
    const radius = Math.max(180, Math.sqrt(Math.max(1, data.nodes.length)) * style.linkDistance * 0.62);
    return data.nodes.map((rawNode, index) => {
      const existing = previous.get(rawNode.id);
      const deterministic = fibonacciShell(index, data.nodes.length, radius, `${nodeTypeKey(rawNode)}:${rawNode.id}`);
      return {
        ...rawNode,
        x: hasFinitePosition(existing) ? existing!.x : deterministic.x + index * 0.01,
        y: hasFinitePosition(existing) ? existing!.y : deterministic.y + index * 0.01,
        z: hasFinitePosition(existing) ? existing!.z : deterministic.z + typeDepthBias(rawNode.type),
      };
    });
  }

  function normalizeEdges(data: RendererData) {
    const nodeIds = new Set(data.nodes.map((node) => node.id));
    return data.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        sourceId: edge.source,
        targetId: edge.target,
      }));
  }

  function relaxInitialLayout() {
    if (nodes.length <= 1) return;
    const movableNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    if (movableNodes.length <= 1) return;
    const largeGraph = movableNodes.length >= LARGE_GRAPH_NODE_THRESHOLD;
    const spatialTargets = largeGraph ? getSpatialTargets(movableNodes) : null;

    const typeBuckets = new Map<string, GraphNode[]>();
    movableNodes.forEach((node) => {
      const key = nodeTypeKey(node);
      typeBuckets.set(key, [...(typeBuckets.get(key) ?? []), node]);
    });

    const typeCenters = new Map<string, Vector3>();
    const sortedTypes = [...typeBuckets.keys()].sort();
    const typeOrbit = Math.max(150, Math.sqrt(movableNodes.length) * style.linkDistance * (largeGraph ? 0.46 : 0.28));
    sortedTypes.forEach((type, index) => {
      const angle = sortedTypes.length <= 1 ? 0 : (index / sortedTypes.length) * Math.PI * 2;
      typeCenters.set(type, new Vector3(
        Math.cos(angle) * typeOrbit,
        Math.sin(angle) * typeOrbit * 0.58,
        typeDepthBias(type) * 1.1
      ));
    });

    for (let iteration = 0; iteration < INITIAL_RELAX_ITERATIONS; iteration += 1) {
      const alpha = 1 - iteration / INITIAL_RELAX_ITERATIONS;

      edges.forEach((edge) => {
        if (!visibleEdgeIds.has(edge.id)) return;
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) return;
        const sourcePos = nodePosition(source);
        const targetPos = nodePosition(target);
        const delta = targetPos.clone().sub(sourcePos);
        const distance = Math.max(1, delta.length());
        const desired = desiredLinkDistance(edge, source, target);
        const correction = (distance - desired) * (largeGraph ? 0.006 : 0.024) * alpha;
        delta.normalize().multiplyScalar(correction);
        source.x = (source.x ?? 0) + delta.x;
        source.y = (source.y ?? 0) + delta.y;
        source.z = (source.z ?? 0) + delta.z;
        target.x = (target.x ?? 0) - delta.x;
        target.y = (target.y ?? 0) - delta.y;
        target.z = (target.z ?? 0) - delta.z;
      });

      if (!largeGraph && movableNodes.length <= MAX_REPULSION_NODES) {
        for (let i = 0; i < movableNodes.length; i += 1) {
          for (let j = i + 1; j < movableNodes.length; j += 1) {
            const a = movableNodes[i];
            const b = movableNodes[j];
            const delta = nodePosition(b).sub(nodePosition(a));
            const distance = Math.max(8, delta.length());
            const minDistance = nodeValue(a) + nodeValue(b) + 28;
            if (distance >= minDistance) continue;
            const push = (minDistance - distance) * 0.018 * alpha;
            delta.normalize().multiplyScalar(push);
            a.x = (a.x ?? 0) - delta.x;
            a.y = (a.y ?? 0) - delta.y;
            a.z = (a.z ?? 0) - delta.z;
            b.x = (b.x ?? 0) + delta.x;
            b.y = (b.y ?? 0) + delta.y;
            b.z = (b.z ?? 0) + delta.z;
          }
        }
      }

      movableNodes.forEach((node) => {
        const spatialTarget = spatialTargets?.get(node.id);
        if (spatialTarget) {
          node.x = (node.x ?? 0) + (spatialTarget.x - (node.x ?? 0)) * 0.018 * alpha;
          node.y = (node.y ?? 0) + (spatialTarget.y - (node.y ?? 0)) * 0.018 * alpha;
          node.z = (node.z ?? 0) + (spatialTarget.z - (node.z ?? 0)) * 0.024 * alpha;
          return;
        }
        const center = typeCenters.get(nodeTypeKey(node));
        if (!center) return;
        node.x = (node.x ?? 0) + (center.x - (node.x ?? 0)) * 0.008 * alpha;
        node.y = (node.y ?? 0) + (center.y - (node.y ?? 0)) * 0.008 * alpha;
        node.z = (node.z ?? 0) + (center.z - (node.z ?? 0)) * 0.012 * alpha;
      });
    }
  }

  function rebuildIndexes() {
    nodeById = new Map(nodes.map((node) => [node.id, node]));
    edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  }

  function nodePosition(node: GraphNode) {
    return new Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);
  }

  function createNodeVisual(node: GraphNode): NodeVisual {
    const group = new Group();
    group.userData = { type: 'node', id: node.id };

    const core = new Mesh(
      sphereGeometry,
      new MeshLambertMaterial({
        color: new Color(getNodeBaseColor(node)),
        transparent: true,
        opacity: style.nodeOpacity,
      })
    );
    core.userData = { type: 'node', id: node.id };
    group.add(core);

    const halo = new Mesh(
      sphereGeometry,
      new MeshBasicMaterial({
        color: new Color(getNodeBaseColor(node)),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    halo.userData = { type: 'node', id: node.id };
    group.add(halo);

    const label = new SpriteText(getNodeDisplayLabel(node));
    label.color = style.labelTextColor;
    label.fontFace = 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif';
    label.fontWeight = '700';
    label.textHeight = 7.2;
    label.backgroundColor = style.name === 'kgCosmic' ? 'rgba(15, 23, 42, 0.58)' : 'rgba(255, 255, 255, 0.72)';
    label.borderColor = style.labelBorderColor;
    label.borderWidth = 0.4;
    label.borderRadius = 4;
    label.padding = 4;
    label.material.depthTest = false;
    label.material.depthWrite = false;
    group.add(label);

    graphGroup.add(group);
    return { group, core, halo, label };
  }

  function createEdgeVisual(edge: GraphLink): EdgeVisual {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    const line = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: new Color(toThreeColor(getEdgeBaseColor(edge))),
        transparent: true,
        opacity: Math.min(0.72, style.linkOpacity * 1.28),
      })
    );
    line.userData = { type: 'edge', id: edge.id };
    if (source && target) setLinePoints(line, nodePosition(source), nodePosition(target));
    graphGroup.add(line);
    return { line };
  }

  function disposeNodeVisual(visual: NodeVisual) {
    visual.core.material.dispose();
    visual.halo.material.dispose();
    visual.label.material.dispose();
    graphGroup.remove(visual.group);
  }

  function disposeEdgeVisual(visual: EdgeVisual) {
    visual.line.geometry.dispose();
    visual.line.material.dispose();
    graphGroup.remove(visual.line);
  }

  function syncNodeVisual(node: GraphNode, visual: NodeVisual) {
    const highlighted = isNodeHighlighted(node.id);
    const active = activeElement?.type === 'node' && activeElement.id === node.id;
    const related = isNodeRelated(node.id);
    const faded = hasFocusContext() && !highlighted && !related && hoveredId !== node.id;
    const size = nodeValue(node);
    const color = getNodeBaseColor(node);

    visual.group.position.copy(nodePosition(node));
    visual.core.scale.setScalar(size);
    visual.core.material.color.set(color);
    visual.core.material.opacity = faded ? 0.22 : active ? 1 : highlighted ? 0.96 : style.nodeOpacity;

    visual.halo.scale.setScalar(size * (active ? 2.2 : highlighted ? 1.8 : related ? 1.28 : 1));
    visual.halo.material.color.set(active ? style.edgeHighlightColor : color);
    visual.halo.material.opacity = active ? 0.2 : highlighted ? 0.15 : related ? 0.035 : 0;

    visual.label.text = getNodeDisplayLabel(node);
    visual.label.visible = shouldShowNodeLabel(node);
    visual.label.textHeight = active ? 11 : highlighted || hoveredId === node.id ? 9.4 : 8;
    visual.label.position.set(0, size + visual.label.textHeight * 1.2, 0);
  }

  function syncEdgeVisual(edge: GraphLink, visual: EdgeVisual) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) return;
    setLinePoints(visual.line, nodePosition(source), nodePosition(target));
    visual.line.material.color.set(toThreeColor(isEdgeHighlighted(edge.id) ? style.edgeHighlightColor : getEdgeBaseColor(edge)));
    const depthBoost = Math.min(0.16, Math.abs((source.z ?? 0) - (target.z ?? 0)) / 1300);
    visual.line.material.opacity = hasFocusContext()
      ? activeNeighborEdgeIds.has(edge.id) || isEdgeHighlighted(edge.id) ? 0.78 : 0.14
      : Math.min(0.76, style.linkOpacity * 1.28 + depthBoost);
  }

  function updateActiveNeighborhood() {
    activeNeighborNodeIds = new Set();
    activeNeighborEdgeIds = new Set();
    if (!activeElement) return;

    if (activeElement.type === 'node') {
      const node = nodeById.get(activeElement.id);
      if (!node) return;
      activeNeighborNodeIds.add(node.id);
      node.neighbors.forEach((id) => activeNeighborNodeIds.add(id));
      edges.forEach((edge) => {
        if (edge.sourceId === node.id || edge.targetId === node.id) activeNeighborEdgeIds.add(edge.id);
      });
      return;
    }

    const edge = edgeById.get(activeElement.id);
    if (!edge) return;
    activeNeighborEdgeIds.add(edge.id);
    activeNeighborNodeIds.add(edge.sourceId);
    activeNeighborNodeIds.add(edge.targetId);
  }

  function syncScene() {
    nodeVisuals.forEach((visual, id) => {
      if (!nodeById.has(id) || !visibleNodeIds.has(id)) {
        disposeNodeVisual(visual);
        nodeVisuals.delete(id);
      }
    });
    edgeVisuals.forEach((visual, id) => {
      if (!edgeById.has(id) || !visibleEdgeIds.has(id)) {
        disposeEdgeVisual(visual);
        edgeVisuals.delete(id);
      }
    });

    nodes.forEach((node) => {
      if (!visibleNodeIds.has(node.id)) return;
      let visual = nodeVisuals.get(node.id);
      if (!visual) {
        visual = createNodeVisual(node);
        nodeVisuals.set(node.id, visual);
      }
      syncNodeVisual(node, visual);
    });

    edges.forEach((edge) => {
      if (!visibleEdgeIds.has(edge.id)) return;
      let visual = edgeVisuals.get(edge.id);
      if (!visual) {
        visual = createEdgeVisual(edge);
        edgeVisuals.set(edge.id, visual);
      }
      syncEdgeVisual(edge, visual);
    });
  }

  function renderFrame() {
    controls.update();
    renderer.render(scene, camera);
  }

  function startRenderLoop() {
    if (animationFrame !== null) return;
    const tick = () => {
      if (destroyed) return;
      renderFrame();
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  }

  function stopRenderLoop() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function applyFilter(control: { allowDefer?: boolean } = {}) {
    visibleNodeIds = new Set();
    nodes.forEach((node) => {
      if (filterState.nodeTypes.length > 0 && !filterState.nodeTypes.includes(node.type)) return;
      if (filterState.hiddenNodeIds.has(node.id)) return;
      visibleNodeIds.add(node.id);
    });

    visibleEdgeIds = new Set();
    edges.forEach((edge) => {
      if (filterState.edgeTypes.length > 0 && !filterState.edgeTypes.includes(edge.type)) return;
      if (filterState.hiddenEdgeIds.has(edge.id)) return;
      if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) return;
      visibleEdgeIds.add(edge.id);
    });

    updateGlobalSearchHighlight();
    rebuildOverviewLabels();
    updateActiveNeighborhood();
    if (control.allowDefer !== false && !hasRenderableSize()) {
      pendingGraphApply = true;
      scheduleSizeRetry();
      return;
    }

    pendingGraphApply = false;
    syncScene();
    startRenderLoop();
    scheduleFit(160);
  }

  function scheduleFit(delay = 160, ids?: string[], padding = style.fitPadding) {
    if (!hasRenderableSize()) {
      scheduleSizeRetry();
      return;
    }
    if (fitTimer !== null) window.clearTimeout(fitTimer);
    fitTimer = window.setTimeout(() => {
      fitTimer = null;
      fitTo(ids, padding);
    }, delay);
  }

  function updateData(data: RendererData) {
    nodes = normalizeNodes(data);
    edges = normalizeEdges(data);
    rebuildIndexes();
    applyFilter({ allowDefer: false });
    const layoutNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    if (layoutNodes.length >= LARGE_GRAPH_NODE_THRESHOLD) {
      applySpatialTargets(layoutNodes, 1);
    }
    relaxInitialLayout();
    syncScene();
    scheduleFit(80);
  }

  function applyPositions(positions: Map<string, Vector3>, fixed = true) {
    void fixed;
    positions.forEach((pos, id) => {
      const node = nodeById.get(id);
      if (!node) return;
      node.x = pos.x;
      node.y = pos.y;
      node.z = pos.z;
    });
    syncScene();
    scheduleFit(120);
  }

  function applyLayout(layout: string, config: LayoutConfig = {}) {
    const layoutNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    if (layoutNodes.length === 0) return;
    const positions = new Map<string, Vector3>();
    const count = layoutNodes.length;

    if (['cose', 'fcose', 'cose-compact', 'cose-loose'].includes(layout)) {
      const targets = getSpatialTargets(layoutNodes);
      targets.forEach((position, id) => positions.set(id, position));
      applyPositions(positions, false);
      relaxInitialLayout();
      syncScene();
      scheduleFit(120);
      return;
    }

    if (['random', 'null', 'preset'].includes(layout)) {
      const radius = Math.max(180, Math.sqrt(count) * style.linkDistance * 0.78);
      layoutNodes.forEach((node) => positions.set(node.id, sphericalSeed(`${layout}:${node.id}`, radius)));
      applyPositions(positions, false);
      return;
    }

    if (layout === 'circle' || layout === 'circle-large' || layout === 'circle-spiral') {
      const baseRadius = Math.max(180, Math.sqrt(count) * style.linkDistance * 0.74);
      const sorted = [...layoutNodes].sort((a, b) => nodeTypeKey(a).localeCompare(nodeTypeKey(b)) || a.id.localeCompare(b.id));
      sorted.forEach((node, index) => {
        const t = count <= 1 ? 0 : index / count;
        const angle = t * Math.PI * 2;
        const ringRadius = layout === 'circle-large' ? baseRadius * 1.35 : layout === 'circle-spiral' ? baseRadius * (0.25 + t) : baseRadius;
        positions.set(node.id, new Vector3(
          Math.cos(angle) * ringRadius,
          Math.sin(angle) * ringRadius,
          layout === 'circle-spiral' ? (t - 0.5) * baseRadius * 1.2 : Math.sin(angle * 2) * baseRadius * 0.16
        ));
      });
      applyPositions(positions);
      return;
    }

    if (layout === 'grid') {
      const cols = Number(config.cols || 0) || Math.ceil(Math.sqrt(count));
      const rows = Number(config.rows || 0) || Math.ceil(count / cols);
      const spacing = Math.max(80, style.linkDistance * 0.82);
      layoutNodes.forEach((node, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        positions.set(node.id, new Vector3(
          (col - (cols - 1) / 2) * spacing,
          (row - (rows - 1) / 2) * spacing,
          ((row + col) % 3 - 1) * spacing * 0.6
        ));
      });
      applyPositions(positions);
      return;
    }

    scheduleFit(160);
  }

  function setActiveElement(active: RendererActiveElement | null) {
    activeElement = active;
    updateActiveNeighborhood();
    syncScene();
    if (active?.type === 'node') {
      const node = nodeById.get(active.id);
      if (node) fitTo([node.id], 90);
    } else if (active?.type === 'edge') {
      const edge = edgeById.get(active.id);
      if (edge) fitTo([edge.sourceId, edge.targetId], 120);
    }
  }

  function setSearchHighlight(payload: { nodeIds?: string[]; edgeIds?: string[] }) {
    searchHighlightNodeIds = new Set(payload.nodeIds ?? []);
    searchHighlightEdgeIds = new Set(payload.edgeIds ?? []);
    updateGlobalSearchHighlight();
    syncScene();
  }

  function clearSearchHighlight() {
    searchHighlightNodeIds = new Set();
    searchHighlightEdgeIds = new Set();
    updateGlobalSearchHighlight();
    syncScene();
  }

  function setPathHighlight(payload: { nodeIds?: string[]; edgeIds?: string[] }) {
    pathHighlightNodeIds = new Set(payload.nodeIds ?? []);
    pathHighlightEdgeIds = new Set(payload.edgeIds ?? []);
    syncScene();
  }

  function clearPathHighlight() {
    pathHighlightNodeIds = new Set();
    pathHighlightEdgeIds = new Set();
    syncScene();
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
  }

  function setNodeSizeOverrides(overrides: Record<string, number> | Map<string, number> | null) {
    if (!overrides) {
      nodeSizeOverrides = null;
    } else if (overrides instanceof Map) {
      nodeSizeOverrides = new Map(overrides);
    } else {
      nodeSizeOverrides = new Map(Object.entries(overrides));
    }
    syncScene();
  }

  function getCameraState() {
    const target = controls.target.clone();
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;
    const distance = Math.max(1, Math.hypot(dx, dy, dz));
    return { target, dx, dy, dz, distance };
  }

  function zoomBy(factor: number) {
    const { target, dx, dy, dz, distance } = getCameraState();
    const nextDistance = Math.max(style.minDistance, Math.min(style.maxDistance, distance / factor));
    const scale = nextDistance / distance;
    camera.position.set(target.x + dx * scale, target.y + dy * scale, target.z + dz * scale);
    controls.target.copy(target);
    controls.update();
  }

  function zoomTo(k: number) {
    const { target, dx, dy, dz, distance } = getCameraState();
    if (baseDistance === null) baseDistance = distance;
    const nextDistance = Math.max(style.minDistance, Math.min(style.maxDistance, baseDistance / Math.max(k, 0.01)));
    const scale = nextDistance / distance;
    camera.position.set(target.x + dx * scale, target.y + dy * scale, target.z + dz * scale);
    controls.target.copy(target);
    controls.update();
  }

  function panTo(x: number, y: number) {
    camera.position.x += x;
    camera.position.y += y;
    controls.target.x += x;
    controls.target.y += y;
    controls.update();
  }

  function center() {
    fitTo(undefined, style.fitPadding);
  }

  function computeBounds(targetNodes: GraphNode[]) {
    const positioned = targetNodes.filter(hasFinitePosition);
    if (positioned.length === 0) return null;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    positioned.forEach((node) => {
      min.x = Math.min(min.x, node.x!);
      min.y = Math.min(min.y, node.y!);
      min.z = Math.min(min.z, node.z!);
      max.x = Math.max(max.x, node.x!);
      max.y = Math.max(max.y, node.y!);
      max.z = Math.max(max.z, node.z!);
    });
    const centerPoint = min.clone().add(max).multiplyScalar(0.5);
    const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1);
    return { center: centerPoint, span };
  }

  function fitTo(nodeIds?: string[], padding = style.fitPadding) {
    if (!hasRenderableSize()) {
      scheduleSizeRetry();
      return;
    }
    const ids = nodeIds?.filter((id) => visibleNodeIds.has(id) && nodeById.has(id)) ?? [];
    const targetNodes = ids.length > 0
      ? ids.map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node))
      : nodes.filter((node) => visibleNodeIds.has(node.id));
    const bounds = computeBounds(targetNodes);
    if (!bounds) return;
    const aspect = Math.max(0.56, width / Math.max(1, height));
    const framing = aspect > 1 ? VIEW_FILL_FACTOR : VIEW_FILL_FACTOR * 1.22;
    const distance = Math.max(
      style.minDistance,
      Math.min(style.maxDistance, bounds.span * framing + padding * 0.42 + style.focusDistance * 0.26)
    );
    camera.position.set(
      bounds.center.x + distance * 0.74,
      bounds.center.y + distance * 0.44,
      bounds.center.z + distance * 0.82
    );
    controls.target.copy(bounds.center);
    controls.update();
  }

  function getTransform() {
    const { target, distance } = getCameraState();
    if (baseDistance === null) baseDistance = distance;
    const k = baseDistance / distance;
    return {
      x: width / 2 - target.x * k,
      y: height / 2 - target.y * k,
      k,
    };
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
    return {
      ...edge,
      source: edge.sourceId,
      target: edge.targetId,
    };
  }

  function getNeighbors(id: string) {
    return nodeById.get(id)?.neighbors ?? [];
  }

  function getAllNodes() {
    return nodes;
  }

  function getAllEdges() {
    return edges.map((edge) => ({
      ...edge,
      source: edge.sourceId,
      target: edge.targetId,
    }));
  }

  async function exportPNG(options?: { background?: string; scale?: number }) {
    const canvas = renderer.domElement;
    const scale = options?.scale ?? 1;
    if (options?.background || scale !== 1) {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = Math.max(1, Math.round(canvas.width * scale));
      exportCanvas.height = Math.max(1, Math.round(canvas.height * scale));
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('Export canvas context is not available');
      if (options?.background) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      }
      ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
      return new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob((blob) => {
          if (!blob) reject(new Error('Failed to export PNG'));
          else resolve(blob);
        }, 'image/png');
      });
    }
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Failed to export PNG'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  async function exportSVG(): Promise<string> {
    throw new Error('3D 模式暂不支持 SVG 导出，请切换到 2D 模式导出。');
  }

  function updateSize() {
    const nextSize = readContainerSize();
    width = nextSize.width;
    height = nextSize.height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, style.maxPixelRatio));
    renderer.setSize(width, height);
    if (hasRenderableSize()) {
      if (pendingGraphApply) {
        pendingGraphApply = false;
        applyFilter({ allowDefer: false });
      }
    } else if (pendingGraphApply) {
      scheduleSizeRetry();
    }
  }

  function pickNode(event: PointerEvent | MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const objects = Array.from(nodeVisuals.values()).map((visual) => visual.core);
    const hit = raycaster.intersectObjects(objects, false)[0];
    if (!hit) return null;
    const id = hit.object.userData.id as string | undefined;
    return id ? nodeById.get(id) ?? null : null;
  }

  function handlePointerMove(event: PointerEvent) {
    const node = pickNode(event);
    const nextType = node ? 'node' : 'background';
    const nextId = node?.id ?? null;
    if (nextType === hoveredType && nextId === hoveredId) return;
    hoveredType = nextType;
    hoveredId = nextId;
    handlers.onHover?.(node
      ? { type: 'node', id: node.id, x: event.clientX, y: event.clientY }
      : { type: 'background', x: event.clientX, y: event.clientY });
    syncScene();
  }

  function handleClick(event: MouseEvent) {
    const node = pickNode(event);
    if (!node) {
      handlers.onClick?.({ type: 'background', x: event.clientX, y: event.clientY });
      return;
    }
    handlers.onClick?.({ type: 'node', id: node.id, x: event.clientX, y: event.clientY });
    const now = performance.now();
    if (lastClickId === node.id && now - lastClickAt < 360) {
      handlers.onDoubleClick?.({ type: 'node', id: node.id });
    }
    lastClickId = node.id;
    lastClickAt = now;
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    const node = pickNode(event);
    handlers.onContextMenu?.(node
      ? { type: 'node', id: node.id, x: event.clientX, y: event.clientY }
      : { type: 'background', x: event.clientX, y: event.clientY });
  }

  const resizeObserver = new ResizeObserver(() => {
    updateSize();
    if (hasRenderableSize()) scheduleFit(160);
  });
  resizeObserver.observe(container);
  updateSize();

  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('click', handleClick);
  renderer.domElement.addEventListener('contextmenu', handleContextMenu);
  startRenderLoop();

  return {
    updateData,
    applyLayout,
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
      destroyed = true;
      if (fitTimer !== null) window.clearTimeout(fitTimer);
      if (sizeRetryTimer !== null) window.clearTimeout(sizeRetryTimer);
      stopRenderLoop();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      nodeVisuals.forEach(disposeNodeVisual);
      edgeVisuals.forEach(disposeEdgeVisual);
      nodeVisuals.clear();
      edgeVisuals.clear();
      sphereGeometry.dispose();
      renderer.dispose();
      controls.dispose();
      renderer.forceContextLoss();
      container.innerHTML = '';
    },
  };
}
