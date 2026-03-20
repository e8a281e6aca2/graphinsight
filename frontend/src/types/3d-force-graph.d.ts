declare module '3d-force-graph' {
  export type ForceGraph3DInstance = {
    graphData: (data?: { nodes: any[]; links: any[] }) => any;
    nodeId: (accessor: string | ((node: any) => string)) => any;
    linkSource: (accessor: string | ((link: any) => string)) => any;
    linkTarget: (accessor: string | ((link: any) => string)) => any;
    nodeLabel: (accessor: (node: any) => string) => any;
    nodeColor: (accessor: (node: any) => string) => any;
    nodeVal: (accessor: (node: any) => number) => any;
    nodeRelSize: (size: number) => any;
    nodeOpacity: (opacity: number) => any;
    nodeResolution: (segments: number) => any;
    nodeThreeObject: (accessor: (node: any) => any) => any;
    nodeThreeObjectExtend: (extend: boolean) => any;
    linkColor: (accessor: (link: any) => string) => any;
    linkWidth: (accessor: (link: any) => number) => any;
    linkOpacity: (opacity: number) => any;
    linkDirectionalArrowLength: (length: number) => any;
    linkDirectionalArrowRelPos: (pos: number) => any;
    linkDirectionalArrowColor: (accessor: (link: any) => string) => any;
    linkDirectionalArrowResolution: (segments: number) => any;
    linkDirectionalParticles: (accessor: (link: any) => number) => any;
    linkDirectionalParticleWidth: (width: number) => any;
    linkDirectionalParticleSpeed: (speed: number) => any;
    linkDirectionalParticleColor: (accessor: (link: any) => string) => any;
    linkResolution: (segments: number) => any;
    width: (width: number) => any;
    height: (height: number) => any;
    backgroundColor: (color: string) => any;
    showNavInfo: (show: boolean) => any;
    zoomToFit: (duration?: number, padding?: number, nodeFilter?: (node: any) => boolean) => any;
    cameraPosition: (
      position?: { x: number; y: number; z: number },
      lookAt?: { x: number; y: number; z: number },
      ms?: number
    ) => any;
    controls: () => any;
    camera: () => any;
    renderer: () => any;
    lights: (lights: any[]) => any;
    postProcessingComposer: () => any;
    refresh: () => any;
    d3Force: (forceName: string) => any;
    onNodeClick: (cb: (node: any, event?: any) => void) => any;
    onLinkClick: (cb: (link: any, event?: any) => void) => any;
    onNodeHover: (cb: (node: any | null, prevNode?: any | null) => void) => any;
    onLinkHover: (cb: (link: any | null, prevLink?: any | null) => void) => any;
    onNodeRightClick: (cb: (node: any, event?: any) => void) => any;
    onLinkRightClick: (cb: (link: any, event?: any) => void) => any;
  };

  export type ForceGraph3DFactory = (element: HTMLElement) => ForceGraph3DInstance;

  export default function ForceGraph3D(): ForceGraph3DFactory;
}
