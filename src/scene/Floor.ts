import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { radialTexture } from './helpers';

/** Suelo: espejo oscuro + rejilla de baldosas + charco de luz bajo la esfera. */
export class Floor {
  readonly group = new THREE.Group();

  private readonly gridMat: THREE.ShaderMaterial;
  private readonly poolMat: THREE.MeshBasicMaterial;

  constructor(size = 70) {
    const mirror = new Reflector(new THREE.PlaneGeometry(size, size), {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x101318,
    });
    mirror.rotation.x = -Math.PI / 2;

    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0x3a6f86) },
          uCell: { value: 1.0 },
          uFade: { value: 13.0 },
          uDim: { value: 1.0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uCell;
          uniform float uFade;
          uniform float uDim;
          varying vec3 vWorld;
          void main() {
            vec2 p = vWorld.xz / uCell;
            vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
            float line = 1.0 - min(min(g.x, g.y), 1.0);
            float d = length(vWorld.xz);
            float fade = exp(-(d * d) / (uFade * uFade));
            gl_FragColor = vec4(uColor, line * fade * 0.38 * uDim);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.002;

    const poolMat = new THREE.MeshBasicMaterial({
      map: radialTexture([
        [0, 'rgba(102,234,255,0.3)'],
        [0.4, 'rgba(102,234,255,0.07)'],
        [1, 'rgba(0,0,0,0)'],
      ]),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.004;

    this.group.add(mirror, grid, pool);
    this.gridMat = grid.material as THREE.ShaderMaterial;
    this.poolMat = poolMat;
  }

  /** Atenúa el suelo al enfocar una sección (`focus` de 0 a 1). */
  setFocus(focus: number): void {
    const dim = 1 - 0.65 * focus;
    this.gridMat.uniforms.uDim.value = dim;
    this.poolMat.opacity = dim;
  }
}
