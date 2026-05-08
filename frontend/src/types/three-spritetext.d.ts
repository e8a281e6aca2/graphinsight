declare module 'three-spritetext' {
  import { SpriteMaterial, Sprite, Vector2 } from 'three';

  export default class SpriteText extends Sprite {
    constructor(text?: string);
    text: string;
    textHeight: number;
    color: string;
    fontFace: string;
    fontWeight: string | number;
    fontSize: number;
    strokeWidth: number;
    strokeColor: string;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    padding: number;
    borderRadius: number;
    center: Vector2;
    material: SpriteMaterial;
  }
}
