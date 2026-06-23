export type Force3DStylePreset = {
  name: string;
  backgroundColor: string;
  labelTextColor: string;
  labelMutedColor: string;
  labelBackground: string;
  labelBorderColor: string;
  labelShadow: string;
  edgeBaseColor: string;
  edgeHighlightColor: string;
  nodeOpacity: number;
  nodeRelSize: number;
  nodeScale: number;
  nodeResolution: number;
  linkOpacity: number;
  linkWidth: number;
  linkResolution: number;
  linkDistance: number;
  arrowLength: number;
  arrowRelPos: number;
  arrowResolution: number;
  chargeStrength: number;
  controlType: 'trackball' | 'orbit' | 'fly';
  minDistance: number;
  maxDistance: number;
  focusDistance: number;
  fitPadding: number;
  labelMaxDistance: number;
  showAllLabelsMaxNodes: number;
  overviewLabelsMaxNodes: number;
  maxPixelRatio: number;
  layerSpread: number;
  layerForceStrength: number;
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  fogNear: number;
  fogFar: number;
};

export const FORCE3D_PRESETS: Record<string, Force3DStylePreset> = {
  kgCosmic: {
    name: 'kgCosmic',
    backgroundColor: '#0b1020',
    labelTextColor: '#e2e8f0',
    labelMutedColor: '#94a3b8',
    labelBackground: 'rgba(15, 23, 42, 0.86)',
    labelBorderColor: 'rgba(148, 163, 184, 0.28)',
    labelShadow: '0 10px 30px rgba(0, 0, 0, 0.38)',
    edgeBaseColor: 'rgba(148, 163, 184, 0.32)',
    edgeHighlightColor: '#f8fafc',
    nodeOpacity: 0.92,
    nodeRelSize: 4.2,
    nodeScale: 1.12,
    nodeResolution: 18,
    linkOpacity: 0.42,
    linkWidth: 0.9,
    linkResolution: 6,
    linkDistance: 125,
    arrowLength: 4.8,
    arrowRelPos: 0.86,
    arrowResolution: 8,
    chargeStrength: -150,
    controlType: 'orbit',
    minDistance: 70,
    maxDistance: 2400,
    focusDistance: 230,
    fitPadding: 120,
    labelMaxDistance: 900,
    showAllLabelsMaxNodes: 60,
    overviewLabelsMaxNodes: 130,
    maxPixelRatio: 2,
    layerSpread: 92,
    layerForceStrength: 0.11,
    ambientLightIntensity: 2.6,
    directionalLightIntensity: 1.45,
    fogNear: 1400,
    fogFar: 5200,
  },
  kgVivid: {
    name: 'kgVivid',
    backgroundColor: '#f8fafc',
    labelTextColor: '#172033',
    labelMutedColor: '#64748b',
    labelBackground: 'rgba(255, 255, 255, 0.94)',
    labelBorderColor: 'rgba(71, 85, 105, 0.16)',
    labelShadow: '0 10px 26px rgba(15, 23, 42, 0.12)',
    edgeBaseColor: 'rgba(71, 85, 105, 0.24)',
    edgeHighlightColor: '#0f172a',
    nodeOpacity: 0.96,
    nodeRelSize: 3.8,
    nodeScale: 1.04,
    nodeResolution: 20,
    linkOpacity: 0.32,
    linkWidth: 0.58,
    linkResolution: 6,
    linkDistance: 118,
    arrowLength: 3.8,
    arrowRelPos: 0.86,
    arrowResolution: 8,
    chargeStrength: -118,
    controlType: 'orbit',
    minDistance: 65,
    maxDistance: 2200,
    focusDistance: 250,
    fitPadding: 135,
    labelMaxDistance: 950,
    showAllLabelsMaxNodes: 65,
    overviewLabelsMaxNodes: 145,
    maxPixelRatio: 2,
    layerSpread: 88,
    layerForceStrength: 0.1,
    ambientLightIntensity: 2.9,
    directionalLightIntensity: 1.25,
    fogNear: 1450,
    fogFar: 5000,
  },
  kgClean: {
    name: 'kgClean',
    backgroundColor: '#f4f6fb',
    labelTextColor: '#0f172a',
    labelMutedColor: '#64748b',
    labelBackground: 'rgba(255, 255, 255, 0.95)',
    labelBorderColor: 'rgba(15, 23, 42, 0.16)',
    labelShadow: '0 10px 26px rgba(15, 23, 42, 0.14)',
    edgeBaseColor: 'rgba(15, 23, 42, 0.34)',
    edgeHighlightColor: '#111827',
    nodeOpacity: 0.96,
    nodeRelSize: 4,
    nodeScale: 1.08,
    nodeResolution: 20,
    linkOpacity: 0.44,
    linkWidth: 0.8,
    linkResolution: 6,
    linkDistance: 116,
    arrowLength: 4.2,
    arrowRelPos: 0.86,
    arrowResolution: 8,
    chargeStrength: -130,
    controlType: 'orbit',
    minDistance: 70,
    maxDistance: 2200,
    focusDistance: 230,
    fitPadding: 120,
    labelMaxDistance: 900,
    showAllLabelsMaxNodes: 70,
    overviewLabelsMaxNodes: 150,
    maxPixelRatio: 2,
    layerSpread: 88,
    layerForceStrength: 0.1,
    ambientLightIntensity: 2.8,
    directionalLightIntensity: 1.3,
    fogNear: 1300,
    fogFar: 4500,
  },
};
