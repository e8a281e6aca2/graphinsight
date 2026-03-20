declare module 'three-spritetext' {
  import { SpriteMaterial, Sprite } from 'three';

  export default class SpriteText extends Sprite {
    constructor(text?: string);
    text: string;
    textHeight: number;
    color: string;
    backgroundColor: string;
    padding: number;
    borderRadius: number;
    material: SpriteMaterial;
  }
}
