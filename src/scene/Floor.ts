import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { radialTexture } from './helpers';

/** Variante suave del shader del Reflector: reflejo atenuado y desvanecido con la distancia. */
const softMirrorShader = {
  name: 'SoftMirror',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uStrength: { value: 0.24 },
    uFade: { value: 5.0 },
    ...THREE.UniformsLib.fog,
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uFade;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj(tDiffuse, vUv);
      float d = length(vWorld.xz);
      float fade = exp(-(d * d) / (uFade * uFade));
      gl_FragColor = vec4(color + base.rgb * uStrength * fade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

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
      color: 0x05080f,
      shader: softMirrorShader,
    });
    (mirror.material as THREE.ShaderMaterial).fog = true;
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
            gl_FragColor = vec4(uColor, line * fade * 0.26 * uDim);
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
