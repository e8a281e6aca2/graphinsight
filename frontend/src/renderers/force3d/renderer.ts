import ForceGraph3D from '3d-force-graph';
import SpriteText from 'three-spritetext';
import {
  AdditiveBlending,
  AmbientLight,
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  PMREMGenerator,
  Points,
  PointsMaterial,
  SphereGeometry,
  TextureLoader,
  Texture,
  SRGBColorSpace,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type {
  RendererAPI,
  RendererActiveElement,
  RendererData,
  RendererEdge,
  RendererEventHandlers,
  RendererNode,
  RendererOptions,
} from '../core/types';
import { FORCE3D_PRESETS } from './stylePresets';
import { generateVideoThumbnail } from '../../utils/videoThumbnail';

type GraphNode = RendererNode & { x?: number; y?: number; z?: number };
type GraphLink = RendererEdge & { source: string; target: string };

type NodeObject = {
  group: Group;
  sphere: Mesh;
  material: MeshPhysicalMaterial;
  label?: SpriteText;
};

type FilterState = {
  nodeTypes: string[];
  edgeTypes: string[];
  hiddenNodeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
};

const DEFAULT_EDGE_COLOR = 'rgba(148, 163, 184, 0.35)';
const ACTIVE_COLOR = '#ff4081';
const HIGHLIGHT_COLOR = '#ffd700';
const PATH_COLOR = '#ff6b6b';

function parseHexColor(hex: string) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    return { r, g, b };
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

function parseCssColor(color: string): { r: number; g: number; b: number; a?: number } | null {
  if (!color) return null;
  if (color.startsWith('#')) {
    const rgb = parseHexColor(color);
    return rgb ? { r: rgb.r, g: rgb.g, b: rgb.b } : null;
  }
  const match = color
    .replace(/\s+/g, '')
    .match(/^rgba?\((\d+(\.\d+)?),(\d+(\.\d+)?),(\d+(\.\d+)?)(?:,(\d+(\.\d+)?))?\)$/i);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[3]);
  const b = Number(match[5]);
  const a = match[7] !== undefined ? Number(match[7]) : undefined;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b, a };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function boostColor(color: string, saturationBoost: number, lightnessBoost: number) {
  const parsed = parseCssColor(color);
  if (!parsed) return color;
  const { r, g, b, a } = parsed;
  const threeColor = new Color(r / 255, g / 255, b / 255);
  const hsl = { h: 0, s: 0, l: 0 };
  threeColor.getHSL(hsl);
  const nextS = clamp01(hsl.s + saturationBoost);
  const nextL = clamp01(hsl.l + lightnessBoost);
  threeColor.setHSL(hsl.h, nextS, nextL);
  const outR = Math.round(threeColor.r * 255);
  const outG = Math.round(threeColor.g * 255);
  const outB = Math.round(threeColor.b * 255);
  if (a !== undefined && a < 1) {
    return `rgba(${outR}, ${outG}, ${outB}, ${a})`;
  }
  return `rgb(${outR}, ${outG}, ${outB})`;
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\(([^)]+)\)/, (_, content) => {
      const parts = content.split(',').map((p: string) => p.trim());
      if (parts.length >= 3) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
      }
      return color;
    });
  }
  if (color.startsWith('rgb')) {
    return color.replace(/rgb\(([^)]+)\)/, (_, content) => `rgba(${content}, ${alpha})`);
  }
  const rgb = parseHexColor(color);
  if (rgb) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
  return color;
}

export function createRenderer3D(
  container: HTMLDivElement,
  handlers: RendererEventHandlers = {},
  options: RendererOptions = {}
): RendererAPI {
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;
  const debugLog = (...args: any[]) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.info('[Force3D]', ...args);
    }
  };
  let width = (options.width ?? container.clientWidth) || 1;
  let height = (options.height ?? container.clientHeight) || 1;
  const style =
    (options.styleName && FORCE3D_PRESETS[options.styleName])
      ? FORCE3D_PRESETS[options.styleName]
      : FORCE3D_PRESETS.kgCosmic;

  let graph: any;
  const graphConfig = {
    controlType: style.controlType,
    rendererConfig: { antialias: true, alpha: true },
  };

  const initGraph = () => {
    const GraphCtor = ForceGraph3D as any;
    try {
      return new GraphCtor(container, graphConfig);
    } catch {
      // ignore and fallback
    }

    try {
      const factory = GraphCtor(graphConfig);
      if (typeof factory === 'function') {
        const maybeInstance = factory(container);
        return maybeInstance || factory;
      }
      return factory;
    } catch {
      // ignore and fallback
    }

    const fallbackFactory = (ForceGraph3D as any)();
    if (typeof fallbackFactory === 'function') {
      const maybeInstance = fallbackFactory(container);
      return maybeInstance || fallbackFactory;
    }
    return fallbackFactory;
  };

  graph = initGraph();

  if (!graph) {
    throw new Error('Failed to initialize 3D graph renderer');
  }
  debugLog('init', { width, height });
  if (isDev && typeof window !== 'undefined') {
    (window as any).__KG_GRAPH_3D__ = graph;
  }

  container.style.minWidth = '1px';
  container.style.minHeight = '1px';
  container.style.width = '100%';
  container.style.height = '100%';

  const ensureRendererDom = () => {
    if (typeof graph === 'function') {
      const renderer = graph.renderer?.();
      const needsBind = !renderer?.domElement || !container.contains(renderer.domElement);
      if (needsBind) {
        try {
          graph(container);
        } catch {
          // ignore
        }
      }
    }

    const renderer = graph.renderer?.();
    if (renderer?.domElement && !container.contains(renderer.domElement)) {
      container.appendChild(renderer.domElement);
    }
    if (renderer?.domElement) {
      debugLog('renderer-dom', {
        canvas: { w: renderer.domElement.width, h: renderer.domElement.height },
      });
    }
  };

  ensureRendererDom();

  let nodes: GraphNode[] = [];
  let edges: GraphLink[] = [];
  let nodeById = new Map<string, GraphNode>();
  let edgeById = new Map<string, GraphLink>();
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

  let nodeSizeOverrides: Map<string, number> | null = null;
  const baseRadiusById = new Map<string, number>();
  const nodeObjectCache = new Map<string, NodeObject>();
  const textureCache = new Map<string, Texture>();
  const texturePending = new Set<string>();
  const textureLoader = new TextureLoader();
  textureLoader.setCrossOrigin('anonymous');
  const sphereGeometry = new SphereGeometry(1, style.nodeResolution, style.nodeResolution);
  let bloomPass: UnrealBloomPass | null = null;
  let customNodesEnabled = false;
  let customNodeRetry = 0;
  let environmentTexture: Texture | null = null;
  let pmremGenerator: PMREMGenerator | null = null;
  let starfield: Points | null = null;

  let lastPointer = { x: 0, y: 0 };
  let hoveredType: 'node' | 'edge' | 'background' = 'background';
  let hoveredId: string | null = null;
  let lastClickId: string | null = null;
  let lastClickTime = 0;
  let suppressBackgroundClick = false;
  let baseDistance: number | null = null;
  let doubleClickTimer: number | null = null;
  let controlsChangeHandler: (() => void) | null = null;
  let fitTimer: number | null = null;
  let lastSize = { width, height };
  let sizeRetryTimer: number | null = null;
  let lastCameraDistance = style.focusDistance * 3;

  const updateLabelVisibility = (distance: number) => {
    const labelDistance = style.labelMaxDistance ?? style.maxDistance * 0.35;
    nodeObjectCache.forEach((entry, id) => {
      if (!entry.label) return;
      const isHovered = hoveredType === 'node' && hoveredId === id;
      const isEmphasized = highlightedNodeIds.has(id);
      const baseScale = entry.sphere.scale.x || 1;
      const isTiny = baseScale < 1.4;
      entry.label.visible = isHovered || isEmphasized || (distance < labelDistance && !isTiny);
    });
  };

  graph
    .width(width)
    .height(height)
    .backgroundColor(style.backgroundColor)
    .showNavInfo?.(false)
    .enablePointerInteraction?.(true)
    .nodeId('id')
    .linkSource('source')
    .linkTarget('target')
    .nodeLabel(() => '')
    .nodeOpacity?.(style.nodeOpacity)
    .nodeResolution?.(style.nodeResolution)
    .linkOpacity?.(style.linkOpacity)
    .linkDirectionalArrowLength(style.arrowLength)
    .linkDirectionalArrowRelPos(style.arrowRelPos)
    .linkDirectionalArrowResolution?.(style.arrowResolution)
    .linkResolution?.(style.linkResolution);

  graph.forceEngine?.('d3');
  graph.numDimensions?.(3);

  const camera = graph.camera?.();
  if (camera) {
    camera.near = 1;
    camera.far = 100000;
    camera.updateProjectionMatrix?.();
  }

  if (typeof graph.d3Force === 'function') {
    graph.d3Force('charge').strength(style.chargeStrength);
    const linkForce = graph.d3Force('link');
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance(style.linkDistance);
    }
  }

  const controls = graph.controls?.();
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.8;
    controls.minDistance = style.minDistance;
    controls.maxDistance = style.maxDistance;
    controlsChangeHandler = () => {
      const { distance } = getCameraState();
      lastCameraDistance = distance;
      updateLabelVisibility(distance);
    };
    controls.addEventListener?.('change', controlsChangeHandler);
  }

  const renderer = graph.renderer?.();
  const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
  if (renderer?.setPixelRatio) {
    const ratio = Math.min(window.devicePixelRatio || 1, style.maxPixelRatio);
    renderer.setPixelRatio(ratio);
  }
  if (renderer) {
    renderer.setClearColor?.(style.backgroundColor, 1);
    (renderer as any).outputColorSpace = SRGBColorSpace;
    (renderer as any).toneMapping = ACESFilmicToneMapping;
    (renderer as any).toneMappingExposure = style.toneMappingExposure ?? 1.12;
    (renderer as any).physicallyCorrectLights = true;
  }

  const keyLight = new DirectionalLight(new Color('#fff1e6'), 0.95);
  keyLight.position.set(1.2, 1, 0.9);
  const fillLight = new DirectionalLight(new Color('#dbeafe'), 0.5);
  fillLight.position.set(-1.1, -0.4, 1.2);
  const rimLight = new DirectionalLight(new Color('#c7d2fe'), 0.3);
  rimLight.position.set(0.4, 1.1, -1.2);

  graph.lights?.([
    new AmbientLight(new Color('#ffffff'), 0.45),
    keyLight,
    fillLight,
    rimLight,
  ]);

  const scene = graph.scene?.();
  if (scene) {
    const fogNear = style.fogNear ?? 900;
    const fogFar = style.fogFar ?? 2600;
    scene.fog = new Fog(style.backgroundColor, fogNear, fogFar);
    if (renderer) {
      pmremGenerator = new PMREMGenerator(renderer);
      const envScene = new RoomEnvironment();
      environmentTexture = pmremGenerator.fromScene(envScene, 0.04).texture;
      scene.environment = environmentTexture;
    }
    if (style.starfieldEnabled) {
      const count = Math.max(1, style.starfieldCount);
      const radius = Math.max(800, style.starfieldRadius);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = Math.pow(Math.random(), 0.5) * radius;
        const sinPhi = Math.sin(phi);
        const x = r * sinPhi * Math.cos(theta);
        const y = r * sinPhi * Math.sin(theta);
        const z = r * Math.cos(phi);
        const idx = i * 3;
        positions[idx] = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const material = new PointsMaterial({
        color: new Color(style.starfieldColor),
        size: style.starfieldSize,
        transparent: true,
        opacity: style.starfieldOpacity,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      });
      starfield = new Points(geometry, material);
      scene.add(starfield);
    }
  }

  setupBloom();

  function getCameraState() {
    const camera = graph.camera();
    const controls = graph.controls();
    const target = controls?.target ?? { x: 0, y: 0, z: 0 };
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;
    const distance = Math.hypot(dx, dy, dz) || 1;
    return { camera, target, dx, dy, dz, distance };
  }

  function setupBloom() {
    if (bloomPass) return;
    const composer = graph.postProcessingComposer?.();
    if (!composer) return;
    bloomPass = new UnrealBloomPass();
    bloomPass.strength = style.bloomStrength;
    bloomPass.radius = style.bloomRadius;
    bloomPass.threshold = style.bloomThreshold;
    composer.addPass(bloomPass);
  }

  function renderOnce() {
    const renderer = graph.renderer?.();
    const scene = (graph as any).scene?.();
    const camera = graph.camera?.();
    if (renderer?.render && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  function hasValidPositions() {
    const graphData = graph.graphData?.();
    const graphNodes: GraphNode[] = graphData?.nodes ?? [];
    return graphNodes.some(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)
    );
  }

  function isFiniteVec(vec?: { x?: number; y?: number; z?: number }) {
    if (!vec) return false;
    return Number.isFinite(vec.x) && Number.isFinite(vec.y) && Number.isFinite(vec.z);
  }

  function ensureCameraValid() {
    const camera = graph.camera?.();
    const controls = graph.controls?.();
    if (!camera) return;
    if (!isFiniteVec(camera.position)) {
      graph.cameraPosition(
        { x: 0, y: 0, z: style.focusDistance * 3 },
        { x: 0, y: 0, z: 0 },
        0
      );
      if (controls?.target?.set) {
        controls.target.set(0, 0, 0);
        controls.update?.();
      }
    }
  }

  function computeBounds(targetIds?: string[]) {
    const sourceNodes = targetIds?.length
      ? targetIds.map((id) => nodeById.get(id)).filter(Boolean)
      : nodes.filter((node) => visibleNodeIds.has(node.id));
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let count = 0;
    sourceNodes.forEach((node) => {
      if (!Number.isFinite(node?.x) || !Number.isFinite(node?.y) || !Number.isFinite(node?.z)) {
        return;
      }
      const nx = node.x as number;
      const ny = node.y as number;
      const nz = node.z as number;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      minZ = Math.min(minZ, nz);
      maxX = Math.max(maxX, nx);
      maxY = Math.max(maxY, ny);
      maxZ = Math.max(maxZ, nz);
      count += 1;
    });
    if (!count || !Number.isFinite(minX)) return null;
    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    };
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, style.focusDistance);
    return { center, size };
  }

  function applyBoundsFit(
    bounds: { center: { x: number; y: number; z: number }; size: number },
    duration = 400,
    padding = style.fitPadding
  ) {
    const { center, size } = bounds;
    const camera = graph.camera?.();
    const fov = camera?.fov ? (camera.fov * Math.PI) / 180 : Math.PI / 4;
    const paddingScale = 1 + padding / Math.max(1, Math.min(width, height));
    const baseDistance = Math.max(
      style.minDistance,
      Math.min(
        style.maxDistance,
        ((size / 2) / Math.max(Math.tan(fov / 2), 0.01)) * paddingScale
      )
    );
    const desiredDistance = Math.max(style.minDistance, baseDistance * style.fitTightness);
    const nextPos = {
      x: center.x,
      y: center.y,
      z: center.z + desiredDistance,
    };
    graph.cameraPosition(nextPos, center, duration);
    const controls = graph.controls?.();
    if (controls?.target?.set) {
      controls.target.set(center.x, center.y, center.z);
      controls.update?.();
    }
    lastCameraDistance = desiredDistance;
    updateLabelVisibility(desiredDistance);
  }

  function scheduleAutoFit(delay = 120) {
    if (fitTimer) {
      window.clearTimeout(fitTimer);
    }
    fitTimer = window.setTimeout(() => {
      if (!hasValidPositions()) {
        primeCamera();
        scheduleAutoFit(160);
        fitTimer = null;
        return;
      }
      primeCamera();
      fitGraph(400);
      const { distance } = getCameraState();
      baseDistance = distance;
      ensureCameraValid();
      fitTimer = null;
    }, delay);
  }

  function primeCamera() {
    graph.cameraPosition(
      { x: 0, y: 0, z: style.focusDistance * 3 },
      { x: 0, y: 0, z: 0 },
      0
    );
    const controls = graph.controls?.();
    if (controls?.target?.set) {
      controls.target.set(0, 0, 0);
      controls.update?.();
    }
  }

  function getTexture(url: string, onLoad?: () => void) {
    if (!url) return null;
    const cached = textureCache.get(url);
    if (cached) return cached;
    if (texturePending.has(url)) return null;
    texturePending.add(url);
    textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        textureCache.set(url, texture);
        texturePending.delete(url);
        if (onLoad) onLoad();
        graph.refresh?.();
      },
      undefined,
      () => {
        texturePending.delete(url);
      }
    );
    return null;
  }

  function ensureNodeObject(node: GraphNode) {
    let entry = nodeObjectCache.get(node.id);
    if (entry) return entry;

    const material = new MeshPhysicalMaterial({
      color: boostColor(node.color, style.nodeColorSaturationBoost, style.nodeColorLightnessBoost),
      roughness: 0.32,
      metalness: 0.2,
      clearcoat: 0.6,
      clearcoatRoughness: 0.18,
    });
    const sphere = new Mesh(sphereGeometry, material);
    const group = new Group();
    group.add(sphere);

    let label: SpriteText | undefined;
    const labelText = node.label || node.id;
    if (labelText) {
      label = new SpriteText(labelText);
      label.material.depthWrite = false;
      label.material.depthTest = false;
      label.color = style.labelColor;
      label.fontFace = 'Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      label.fontWeight = '600';
      label.fontSize = style.labelFontSize ?? 130;
      label.strokeWidth = style.labelStrokeWidth ?? 0;
      label.strokeColor = style.labelStrokeColor ?? 'rgba(15, 23, 42, 0.4)';
      label.textHeight = style.labelSize;
      label.backgroundColor = style.labelBackground;
      label.borderColor = 'rgba(15, 23, 42, 0.12)';
      label.borderWidth = 2;
      label.padding = 6;
      label.borderRadius = 4;
      label.center.y = -0.6;
      group.add(label);
    }

    entry = { group, sphere, material, label };
    nodeObjectCache.set(node.id, entry);
    return entry;
  }

  function updateNodeObject(entry: NodeObject, node: GraphNode) {
    const baseRadius = baseRadiusById.get(node.id) ?? node.radius ?? 24;
    const override = nodeSizeOverrides?.get(node.id);
    const radius = (override ?? baseRadius) * style.nodeScale;
    const scale = Math.max(1, radius / 6);
    entry.sphere.scale.set(scale, scale, scale);

    if (entry.label) {
      const labelDistance = style.labelMaxDistance ?? style.maxDistance * 0.35;
      const distanceScale = Math.min(1, Math.max(0.5, labelDistance / Math.max(lastCameraDistance, 1)));
      const baseTextHeight = style.labelSize;
      const targetTextHeight = Math.max(baseTextHeight * distanceScale, scale * 1.2);
      const fontScale = targetTextHeight / Math.max(baseTextHeight, 1);
      const baseFontSize = style.labelFontSize ?? 130;
      const maxFontSize = style.labelFontSizeMax ?? baseFontSize * 1.8;
      const nextFontSize = Math.min(maxFontSize, Math.round(baseFontSize * fontScale));

      entry.label.text = node.label || node.id;
      if (entry.label.textHeight !== targetTextHeight) {
        entry.label.textHeight = targetTextHeight;
      }
      if (entry.label.fontSize !== nextFontSize) {
        entry.label.fontSize = nextFontSize;
      }
      entry.label.position.y = scale * 1.6;
      const isHovered = hoveredType === 'node' && hoveredId === node.id;
      const isHighlighted = highlightedNodeIds.has(node.id);
      const isTiny = scale < 1.4;
      entry.label.visible = isHovered || isHighlighted || (lastCameraDistance < labelDistance && !isTiny);
      if (entry.label.material?.map) {
        entry.label.material.map.anisotropy = maxAnisotropy;
        entry.label.material.map.minFilter = LinearFilter;
        entry.label.material.map.magFilter = LinearFilter;
        entry.label.material.map.needsUpdate = true;
      }
    }

    const isActiveNode = activeElement?.type === 'node' && activeElement.id === node.id;
    const isPathHighlighted = pathHighlightNodeIds.has(node.id);
    const isSearchHighlighted = searchHighlightNodeIds.has(node.id);
    const isActiveRelated = activeHighlightNodeIds.has(node.id);
    const isEmphasized = isActiveNode || isPathHighlighted || isSearchHighlighted || isActiveRelated;

    const baseColor = boostColor(
      node.color,
      style.nodeColorSaturationBoost,
      style.nodeColorLightnessBoost
    );
    const color = isActiveNode
      ? ACTIVE_COLOR
      : isPathHighlighted
        ? PATH_COLOR
        : isSearchHighlighted
          ? HIGHLIGHT_COLOR
          : isActiveRelated
            ? HIGHLIGHT_COLOR
            : baseColor;

    const imageUrl = node.videoThumbnailUrl || node.image;
    const texture = imageUrl ? getTexture(imageUrl, () => refreshStyles()) : null;
    entry.material.map = texture || null;
    entry.material.color.set(texture ? '#ffffff' : color);
    entry.material.roughness = texture ? 0.6 : 0.32;
    entry.material.metalness = texture ? 0.04 : 0.2;
    entry.material.clearcoat = texture ? 0.2 : 0.6;
    entry.material.clearcoatRoughness = texture ? 0.6 : 0.18;
    const emissiveBase = texture
      ? '#000000'
      : boostColor(baseColor, 0.08, 0.04);
    entry.material.emissive.set(isEmphasized ? color : emissiveBase);
    entry.material.emissiveIntensity = isEmphasized ? 0.24 : (texture ? 0.02 : 0.04);
    entry.material.transparent = true;
    entry.material.opacity = highlightedNodeIds.size > 0 && !isEmphasized ? 0.25 : 1;
    entry.material.needsUpdate = true;
  }

  function preloadMedia(nextNodes: GraphNode[]) {
    nextNodes.forEach((node) => {
      if (node.isVideo && node.video && !node.videoThumbnailUrl && !node.image) {
        generateVideoThumbnail(node.video)
          .then((thumbnail) => {
            node.videoThumbnailUrl = thumbnail;
            getTexture(thumbnail, () => refreshStyles());
          })
          .catch(() => null);
      }

      const imageUrl = node.videoThumbnailUrl || node.image;
      if (imageUrl) {
        getTexture(imageUrl, () => refreshStyles());
      }
    });
  }

  function applyFilter() {
    visibleNodeIds = new Set<string>();
    nodes.forEach((node) => {
      if (filterState.nodeTypes.length > 0 && !filterState.nodeTypes.includes(node.type)) return;
      if (filterState.hiddenNodeIds.has(node.id)) return;
      visibleNodeIds.add(node.id);
    });

    visibleEdgeIds = new Set<string>();
    const filteredEdges = edges.filter((edge) => {
      if (filterState.edgeTypes.length > 0 && !filterState.edgeTypes.includes(edge.type)) return false;
      if (filterState.hiddenEdgeIds.has(edge.id)) return false;
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as GraphNode)?.id;
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as GraphNode)?.id;
      if (!sourceId || !targetId) return false;
      if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) return false;
      visibleEdgeIds.add(edge.id);
      return true;
    });

    const filteredNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    graph.graphData({ nodes: filteredNodes, links: filteredEdges });
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
            const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as GraphNode)?.id;
            const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as GraphNode)?.id;
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
          const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as GraphNode)?.id;
          const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as GraphNode)?.id;
          if (sourceId) activeHighlightNodeIds.add(sourceId);
          if (targetId) activeHighlightNodeIds.add(targetId);
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

  function refreshStyles() {
    const hasHighlight = highlightedNodeIds.size > 0 || highlightedEdgeIds.size > 0;
    const { distance } = getCameraState();
    lastCameraDistance = distance;

    if (customNodesEnabled) {
      nodes.forEach((node) => {
        const entry = ensureNodeObject(node);
        updateNodeObject(entry, node);
      });
    }

    graph.nodeColor((node: GraphNode) => {
      const isActiveNode = activeElement?.type === 'node' && activeElement.id === node.id;
      const isPathHighlighted = pathHighlightNodeIds.has(node.id);
      const isSearchHighlighted = searchHighlightNodeIds.has(node.id);
      const isActiveRelated = activeHighlightNodeIds.has(node.id);
      const isEmphasized = isActiveNode || isPathHighlighted || isSearchHighlighted || isActiveRelated;
      const baseColor = boostColor(
        node.color,
        style.nodeColorSaturationBoost,
        style.nodeColorLightnessBoost
      );
      const color = isActiveNode
        ? ACTIVE_COLOR
        : isPathHighlighted
          ? PATH_COLOR
          : isSearchHighlighted
            ? HIGHLIGHT_COLOR
            : isActiveRelated
              ? HIGHLIGHT_COLOR
              : baseColor;

      if (hasHighlight && !isEmphasized) {
        return withAlpha(color, 0.2);
      }
      return color;
    });

    graph.linkColor((edge: GraphLink) => {
      const isActiveEdge = activeElement?.type === 'edge' && activeElement.id === edge.id;
      const isPathHighlighted = pathHighlightEdgeIds.has(edge.id);
      const isSearchHighlighted = searchHighlightEdgeIds.has(edge.id);
      const isActiveRelated = activeHighlightEdgeIds.has(edge.id);
      const isEmphasized = isActiveEdge || isPathHighlighted || isSearchHighlighted || isActiveRelated;
      const baseColor = boostColor(
        edge.color || style.edgeBaseColor || DEFAULT_EDGE_COLOR,
        style.edgeColorSaturationBoost,
        style.edgeColorLightnessBoost
      );
      const color = isActiveEdge
        ? ACTIVE_COLOR
        : isPathHighlighted
          ? PATH_COLOR
          : isSearchHighlighted
            ? HIGHLIGHT_COLOR
            : isActiveRelated
              ? HIGHLIGHT_COLOR
              : baseColor;

      if (hasHighlight && !isEmphasized) {
        return withAlpha(color, 0.2);
      }
      return color;
    });

    graph.linkDirectionalArrowColor((edge: GraphLink) => {
      const baseColor = boostColor(
        edge.color || style.edgeBaseColor || DEFAULT_EDGE_COLOR,
        style.edgeColorSaturationBoost,
        style.edgeColorLightnessBoost
      );
      if (!highlightedEdgeIds.size) return baseColor;
      if (highlightedEdgeIds.has(edge.id)) return baseColor;
      return withAlpha(baseColor, 0.2);
    });

    graph.linkWidth((edge: GraphLink) => {
      const isActiveEdge = activeElement?.type === 'edge' && activeElement.id === edge.id;
      const isPathHighlighted = pathHighlightEdgeIds.has(edge.id);
      const isSearchHighlighted = searchHighlightEdgeIds.has(edge.id);
      const isActiveRelated = activeHighlightEdgeIds.has(edge.id);
      const baseWidth = style.linkWidth;
      return isActiveEdge ? baseWidth * 2.2 : isPathHighlighted ? baseWidth * 2 : isSearchHighlighted ? baseWidth * 1.6 : isActiveRelated ? baseWidth * 1.6 : baseWidth;
    });

    graph.linkDirectionalParticles((edge: GraphLink) => {
      const isActiveEdge = activeElement?.type === 'edge' && activeElement.id === edge.id;
      const isPathHighlighted = pathHighlightEdgeIds.has(edge.id);
      const isSearchHighlighted = searchHighlightEdgeIds.has(edge.id);
      const isActiveRelated = activeHighlightEdgeIds.has(edge.id);
      return isActiveEdge || isPathHighlighted ? 2 : 0;
    });

    graph.linkDirectionalParticleWidth?.(style.particleWidth);
    graph.linkDirectionalParticleSpeed?.(style.particleSpeed);
    graph.linkDirectionalParticleColor?.((edge: GraphLink) => {
      const baseColor = boostColor(
        edge.color || style.edgeBaseColor || DEFAULT_EDGE_COLOR,
        style.edgeColorSaturationBoost,
        style.edgeColorLightnessBoost
      );
      if (!highlightedEdgeIds.size) return baseColor;
      if (highlightedEdgeIds.has(edge.id)) return baseColor;
      return withAlpha(baseColor, 0.3);
    });

    graph.nodeRelSize(style.nodeRelSize);
    graph.nodeVal((node: GraphNode) => {
      const baseRadius = baseRadiusById.get(node.id) ?? node.radius ?? 24;
      const override = nodeSizeOverrides?.get(node.id);
      const radius = (override ?? baseRadius) * style.nodeScale;
      return Math.max(1, radius / 6);
    });

    updateLabelVisibility(lastCameraDistance);
  }

  function enableCustomNodes() {
    if (customNodesEnabled) return;
    customNodesEnabled = true;
    graph
      .nodeThreeObject((node: GraphNode) => {
        const entry = ensureNodeObject(node);
        updateNodeObject(entry, node);
        return entry.group;
      })
      .nodeThreeObjectExtend(true);
    refreshStyles();
    graph.refresh?.();
  }

  function scheduleCustomNodes(delay = 200) {
    if (customNodesEnabled) return;
    if (customNodeRetry >= 6) return;
    customNodeRetry += 1;
    window.setTimeout(() => {
      if (customNodesEnabled) return;
      const renderer = graph.renderer?.();
      const canvas = renderer?.domElement as HTMLCanvasElement | undefined;
      const hasSize = Boolean(canvas && canvas.width > 0 && canvas.height > 0);
      const data = graph.graphData?.();
      const hasNodes = Boolean(data?.nodes && data.nodes.length > 0);
      if (hasSize && hasNodes) {
        enableCustomNodes();
      } else {
        scheduleCustomNodes(200);
      }
    }, delay);
  }

  function updateSize() {
    const rect = container.getBoundingClientRect();
    let nextWidth = (options.width ?? rect.width ?? container.clientWidth) || 0;
    let nextHeight = (options.height ?? rect.height ?? container.clientHeight) || 0;

    if ((!nextWidth || !nextHeight) && container.parentElement) {
      const parentRect = container.parentElement.getBoundingClientRect();
      nextWidth = nextWidth || parentRect.width;
      nextHeight = nextHeight || parentRect.height;
    }

    if (!nextWidth || !nextHeight) {
      if (sizeRetryTimer === null) {
        sizeRetryTimer = window.setTimeout(() => {
          sizeRetryTimer = null;
          updateSize();
        }, 120);
      }
      return;
    }
    width = Math.max(1, Math.round(nextWidth));
    height = Math.max(1, Math.round(nextHeight));
    graph.width(width).height(height);
    const renderer = graph.renderer?.();
    if (renderer?.setPixelRatio) {
      const ratio = Math.min(window.devicePixelRatio || 1, style.maxPixelRatio);
      renderer.setPixelRatio(ratio);
    }
    if (renderer?.setClearColor) {
      renderer.setClearColor(style.backgroundColor, 1);
    }
    if (renderer?.domElement) {
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
    }
    ensureRendererDom();
    graph.refresh?.();
    if (!customNodesEnabled) {
      scheduleCustomNodes(120);
    }
    if (width !== lastSize.width || height !== lastSize.height) {
      lastSize = { width, height };
      scheduleAutoFit(120);
      debugLog('resize', { width, height });
    }
  }

  function handleBackgroundClick() {
    if (suppressBackgroundClick) return;
    handlers.onClick?.({ type: 'background', x: lastPointer.x, y: lastPointer.y });
  }

  function handleBackgroundContextMenu() {
    handlers.onContextMenu?.({ type: 'background', x: lastPointer.x, y: lastPointer.y });
  }

  graph.onNodeHover((node: GraphNode | null) => {
    if (node) {
      hoveredType = 'node';
      hoveredId = node.id;
      handlers.onHover?.({ type: 'node', id: node.id, x: lastPointer.x, y: lastPointer.y });
      updateLabelVisibility(lastCameraDistance);
      return;
    }
    if (hoveredType !== 'background') {
      hoveredType = 'background';
      hoveredId = null;
      handlers.onHover?.({ type: 'background', x: lastPointer.x, y: lastPointer.y });
      updateLabelVisibility(lastCameraDistance);
    }
  });

  graph.onLinkHover((link: GraphLink | null) => {
    if (link) {
      hoveredType = 'edge';
      hoveredId = link.id;
      handlers.onHover?.({ type: 'edge', id: link.id, x: lastPointer.x, y: lastPointer.y });
      updateLabelVisibility(lastCameraDistance);
      return;
    }
    if (hoveredType !== 'background') {
      hoveredType = 'background';
      hoveredId = null;
      handlers.onHover?.({ type: 'background', x: lastPointer.x, y: lastPointer.y });
      updateLabelVisibility(lastCameraDistance);
    }
  });

  graph.onNodeClick((node: GraphNode | null) => {
    if (!node) return;
    suppressBackgroundClick = true;
    handlers.onClick?.({ type: 'node', id: node.id, x: lastPointer.x, y: lastPointer.y });
    const now = performance.now();
    if (lastClickId === node.id && now - lastClickTime < 350) {
      handlers.onDoubleClick?.({ type: 'node', id: node.id });
    }
    lastClickId = node.id;
    lastClickTime = now;
    window.setTimeout(() => {
      suppressBackgroundClick = false;
    }, 0);
  });

  graph.onLinkClick((link: GraphLink | null) => {
    if (!link) return;
    suppressBackgroundClick = true;
    handlers.onClick?.({ type: 'edge', id: link.id, x: lastPointer.x, y: lastPointer.y });
    window.setTimeout(() => {
      suppressBackgroundClick = false;
    }, 0);
  });

  if (typeof graph.onNodeRightClick === 'function') {
    graph.onNodeRightClick((node: GraphNode | null, event?: PointerEvent) => {
      if (!node) return;
      const x = event?.clientX ?? lastPointer.x;
      const y = event?.clientY ?? lastPointer.y;
      handlers.onContextMenu?.({ type: 'node', id: node.id, x, y });
    });
  }

  if (typeof graph.onLinkRightClick === 'function') {
    graph.onLinkRightClick((link: GraphLink | null, event?: PointerEvent) => {
      if (!link) return;
      const x = event?.clientX ?? lastPointer.x;
      const y = event?.clientY ?? lastPointer.y;
      handlers.onContextMenu?.({ type: 'edge', id: link.id, x, y });
    });
  }

  const handlePointerMove = (event: PointerEvent) => {
    lastPointer = { x: event.clientX, y: event.clientY };
  };

  const handleClick = () => {
    if (hoveredType === 'background') {
      if (doubleClickTimer) {
        window.clearTimeout(doubleClickTimer);
        doubleClickTimer = null;
        fitTo(undefined, style.fitPadding);
        return;
      }
      doubleClickTimer = window.setTimeout(() => {
        handleBackgroundClick();
        doubleClickTimer = null;
      }, 240);
    }
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (hoveredType === 'background') {
      lastPointer = { x: event.clientX, y: event.clientY };
      handleBackgroundContextMenu();
    }
  };

  container.addEventListener('pointermove', handlePointerMove);
  container.addEventListener('click', handleClick);
  container.addEventListener('contextmenu', handleContextMenu);

  const resizeObserver = new ResizeObserver(() => {
    updateSize();
  });
  resizeObserver.observe(container);
  if (container.parentElement) {
    resizeObserver.observe(container.parentElement);
  }

  function updateData(data: RendererData) {
    ensureRendererDom();
    updateSize();
    customNodeRetry = 0;
    baseRadiusById.clear();
    nodeObjectCache.forEach((entry) => {
      entry.material.dispose();
    });
    nodeObjectCache.clear();
    nodes = data.nodes.map((node) => {
      baseRadiusById.set(node.id, node.radius ?? 24);
      return { ...node };
    });
    edges = data.edges.map((edge) => ({ ...edge }));
    nodeById = new Map(nodes.map((node) => [node.id, node]));
    edgeById = new Map(edges.map((edge) => [edge.id, edge]));

    const hasPosition = nodes.some(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)
    );
    if (!hasPosition && nodes.length > 0) {
      const radius = Math.cbrt(nodes.length) * 60 + 160;
      nodes.forEach((node, index) => {
        const angle = (index / nodes.length) * Math.PI * 2;
        node.x = Math.cos(angle) * radius;
        node.y = Math.sin(angle) * radius;
        node.z = ((index % 9) - 4) * 30;
      });
    }

    preloadMedia(nodes);
    applyFilter();
    updateHighlights();
    refreshStyles();
    graph.refresh?.();
    scheduleCustomNodes(200);
    renderOnce();
    debugLog('data', {
      nodes: nodes.length,
      edges: edges.length,
      visibleNodes: visibleNodeIds.size,
      visibleEdges: visibleEdgeIds.size,
    });

    primeCamera();
    graph.resumeAnimation?.();
    ensureCameraValid();
    graph.d3ReheatSimulation?.();
    scheduleAutoFit(200);

    let tickHandled = false;
    graph.onEngineTick?.(() => {
      if (tickHandled) return;
      tickHandled = true;
      scheduleAutoFit(0);
      graph.onEngineTick?.(() => {});
    });

    window.setTimeout(() => {
      if (tickHandled) return;
      const graphData = graph.graphData?.();
      const graphNodes: GraphNode[] = graphData?.nodes ?? [];
      if (graphNodes.length) {
        const hasPosition = graphNodes.some((node) =>
          Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)
        );
        if (!hasPosition) {
          const radius = Math.cbrt(graphNodes.length) * 60 + 120;
          graphNodes.forEach((node, index) => {
            const angle = (index / graphNodes.length) * Math.PI * 2;
            node.x = Math.cos(angle) * radius;
            node.y = Math.sin(angle) * radius;
            node.z = ((index % 7) - 3) * 30;
          });
          graph.graphData?.({ nodes: graphNodes, links: graphData?.links ?? [] });
        }
      }
      scheduleAutoFit(0);
    }, 700);
  }

  function setActiveElement(nextActive: RendererActiveElement | null) {
    activeElement = nextActive;
    updateHighlights();
    refreshStyles();
  }

  function setSearchHighlight(payload: { nodeIds?: string[]; edgeIds?: string[] }) {
    searchHighlightNodeIds = new Set(payload.nodeIds ?? []);
    searchHighlightEdgeIds = new Set(payload.edgeIds ?? []);
    updateHighlights();
    refreshStyles();
  }

  function clearSearchHighlight() {
    searchHighlightNodeIds = new Set();
    searchHighlightEdgeIds = new Set();
    updateHighlights();
    refreshStyles();
  }

  function setPathHighlight(payload: { nodeIds?: string[]; edgeIds?: string[] }) {
    pathHighlightNodeIds = new Set(payload.nodeIds ?? []);
    pathHighlightEdgeIds = new Set(payload.edgeIds ?? []);
    updateHighlights();
    refreshStyles();
  }

  function clearPathHighlight() {
    pathHighlightNodeIds = new Set();
    pathHighlightEdgeIds = new Set();
    updateHighlights();
    refreshStyles();
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
    updateHighlights();
    refreshStyles();
  }

  function setNodeSizeOverrides(overrides: Record<string, number> | Map<string, number> | null) {
    if (!overrides) {
      nodeSizeOverrides = null;
    } else if (overrides instanceof Map) {
      nodeSizeOverrides = new Map(overrides);
    } else {
      nodeSizeOverrides = new Map(Object.entries(overrides));
    }
    refreshStyles();
  }

  function zoomBy(factor: number) {
    const { target, dx, dy, dz, distance } = getCameraState();
    const nextDistance = Math.max(style.minDistance, Math.min(style.maxDistance, distance / factor));
    const scale = nextDistance / distance;
    graph.cameraPosition(
      {
        x: target.x + dx * scale,
        y: target.y + dy * scale,
        z: target.z + dz * scale,
      },
      target,
      200
    );
    lastCameraDistance = nextDistance;
    updateLabelVisibility(nextDistance);
  }

  function zoomTo(k: number) {
    const { target, dx, dy, dz, distance } = getCameraState();
    if (baseDistance === null) {
      baseDistance = distance;
    }
    const desiredDistance = Math.max(style.minDistance, Math.min(style.maxDistance, baseDistance / k));
    const scale = desiredDistance / distance;
    graph.cameraPosition(
      {
        x: target.x + dx * scale,
        y: target.y + dy * scale,
        z: target.z + dz * scale,
      },
      target,
      300
    );
    lastCameraDistance = desiredDistance;
    updateLabelVisibility(desiredDistance);
  }

  function panTo(x: number, y: number) {
    const { camera, target } = getCameraState();
    const offset = {
      x: camera.position.x - target.x,
      y: camera.position.y - target.y,
      z: camera.position.z - target.z,
    };
    const nextTarget = { x, y, z: 0 };
    graph.cameraPosition(
      {
        x: nextTarget.x + offset.x,
        y: nextTarget.y + offset.y,
        z: nextTarget.z + offset.z,
      },
      nextTarget,
      300
    );
  }

  function center() {
    fitTo(undefined, 80);
  }

  function fitGraph(duration = 400, padding = style.fitPadding) {
    const bounds = computeBounds();
    if (bounds) {
      applyBoundsFit(bounds, duration, padding);
      return true;
    }
    return false;
  }

  function fitTo(nodeIds?: string[], padding = style.fitPadding) {
    if (!hasValidPositions()) {
      scheduleAutoFit(160);
      return;
    }

    if (!nodeIds || nodeIds.length === 0) {
      fitGraph(400, padding);
      ensureCameraValid();
      return;
    }

    if (nodeIds.length === 1) {
      const node = nodeById.get(nodeIds[0]);
      if (
        node
        && Number.isFinite(node.x)
        && Number.isFinite(node.y)
        && Number.isFinite(node.z)
      ) {
        const nx = node.x ?? 0;
        const ny = node.y ?? 0;
        const nz = node.z ?? 0;
        const distance = style.focusDistance;
        const distRatio = 1 + distance / Math.hypot(nx, ny, nz || 1);
        const newPos = nx || ny || nz
          ? { x: nx * distRatio, y: ny * distRatio, z: nz * distRatio }
          : { x: 0, y: 0, z: distance };
        graph.cameraPosition(newPos, { x: nx, y: ny, z: nz }, 400);
        lastCameraDistance = distance;
        updateLabelVisibility(distance);
        return;
      }
    }

    const bounds = computeBounds(nodeIds);
    if (bounds) {
      applyBoundsFit(bounds, 400, padding);
    }
    ensureCameraValid();
  }

  function getTransform() {
    const { target, distance } = getCameraState();
    if (baseDistance === null) {
      baseDistance = distance;
    }
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
    return edgeById.get(id);
  }

  function getNeighbors(id: string) {
    const node = nodeById.get(id);
    return node ? node.neighbors : [];
  }

  function getAllNodes() {
    return nodes;
  }

  function getAllEdges() {
    return edges;
  }

  async function exportPNG(options?: { background?: string; scale?: number }) {
    const renderer = graph.renderer();
    if (!renderer?.domElement) {
      throw new Error('3D renderer canvas not available');
    }
    const canvas = renderer.domElement as HTMLCanvasElement;
    const scale = options?.scale ?? 1;

    if (scale === 1) {
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to export PNG'));
            return;
          }
          resolve(blob);
        }, 'image/png');
      });
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(1, Math.round(canvas.width * scale));
    exportCanvas.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Export canvas context is not available');
    }
    ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
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

  async function exportSVG() {
    throw new Error('3D 模式暂不支持 SVG 导出，请切换到 2D 模式导出。');
  }

  updateSize();
  requestAnimationFrame(() => updateSize());
  window.setTimeout(() => updateSize(), 120);

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
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('click', handleClick);
      container.removeEventListener('contextmenu', handleContextMenu);
      if (doubleClickTimer) {
        window.clearTimeout(doubleClickTimer);
        doubleClickTimer = null;
      }
      const controls = graph.controls?.();
      if (controls && controlsChangeHandler) {
        controls.removeEventListener?.('change', controlsChangeHandler);
      }
      graph.pauseAnimation?.();
      graph._destructor?.();
      const renderer = graph.renderer?.();
      if (renderer?.dispose) {
        renderer.dispose();
      }
      if (renderer?.forceContextLoss) {
        renderer.forceContextLoss();
      }
      if (renderer?.domElement?.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      sphereGeometry.dispose();
      textureCache.forEach((texture) => texture.dispose());
      if (starfield) {
        starfield.geometry.dispose();
        const material = starfield.material as PointsMaterial;
        material.dispose();
        starfield = null;
      }
      if (environmentTexture) {
        environmentTexture.dispose();
        environmentTexture = null;
      }
      if (pmremGenerator) {
        pmremGenerator.dispose();
        pmremGenerator = null;
      }
      container.innerHTML = '';
    },
  };
}
