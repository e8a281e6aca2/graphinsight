declare module 'three/examples/jsm/environments/RoomEnvironment.js' {
  import { Scene } from 'three';

  export class RoomEnvironment extends Scene {
    constructor();
  }
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass.js' {
  import { Material, Vector2 } from 'three';

  export class UnrealBloomPass {
    constructor(
      resolution?: Vector2,
      strength?: number,
      radius?: number,
      threshold?: number
    );
    enabled: boolean;
    needsSwap: boolean;
    renderToScreen: boolean;
    clear: boolean;
    strength: number;
    radius: number;
    threshold: number;
    materialCopy: Material;
    setSize(width: number, height: number): void;
    render(...args: any[]): void;
    dispose(): void;
  }
}
