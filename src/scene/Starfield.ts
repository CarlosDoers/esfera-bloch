import * as THREE from 'three';

/** Estrellas lejanas (no afectadas por la niebla). */
export class Starfield {
  readonly points: THREE.Points;

  constructor(count = 2200) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 45 + Math.random() * 25;
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(phi);
      pos[i * 3 + 1] = Math.abs(r * u) * 0.6 + 1; // preferentemente por encima del horizonte
      pos[i * 3 + 2] = r * s * Math.sin(phi);
      c.setHSL(0.55 + Math.random() * 0.15, 0.5, 0.65 + Math.random() * 0.35);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.14,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        fog: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  update(dt: number, focus: number): void {
    this.points.rotation.y += dt * 0.004;
    (this.points.material as THREE.PointsMaterial).opacity = 0.9 * (1 - 0.7 * focus);
  }
}
