import * as THREE from 'three';
import { circlePoints, fresnelMaterial, glowSprite, makeLabel } from './helpers';

const CYAN = 0x66eaff;
const PINK = 0xff4fd8;
const REST_DIM = 0.16; // intensidad que conserva la esfera con una sección enfocada

type Fadeable = THREE.Material & { opacity: number };

/** Esfera de Bloch: rejilla punteada, ecuador, hélice y vector de estado. */
export class BlochSphere {
  readonly group = new THREE.Group();

  private time = 0;
  private dim = 1;
  private readonly fades: Array<{ mat: Fadeable; base: number }> = [];
  private readonly ketLabels: HTMLElement[] = [];
  private readonly rimMat: THREE.ShaderMaterial;
  private readonly helix: THREE.CatmullRomCurve3;
  private readonly runner: THREE.Object3D;
  private readonly runnerGlow: THREE.Sprite;
  private readonly vector: THREE.Group;
  private readonly equatorMat: THREE.MeshBasicMaterial;
  private readonly coreGlow: THREE.Sprite;

  constructor() {
    this.rimMat = this.buildShell();
    this.buildGrid();
    this.buildKets();
    this.equatorMat = this.buildEquator();
    this.helix = this.buildHelix();
    this.runner = this.buildRunner();
    this.runnerGlow = this.runner.children[0] as THREE.Sprite;
    this.vector = this.buildStateVector();
    this.coreGlow = glowSprite('rgba(255,79,216,1)', 1.6, 0.35);
    this.group.add(this.coreGlow);
  }

  /** `focus` va de 0 (nada seleccionado) a 1 (sección enfocada: la esfera se atenúa). */
  update(dt: number, focus: number): void {
    this.time += dt;
    this.dim = 1 - (1 - REST_DIM) * focus;

    // Fotón recorriendo la hélice.
    const t = (this.time * 0.07) % 1;
    this.runner.position.copy(this.helix.getPointAt(t));
    this.runnerGlow.material.opacity = (0.6 + 0.4 * Math.sin(this.time * 9)) * this.dim;

    // Precesión de Larmor del vector de estado alrededor de Z.
    this.vector.rotation.y = this.time * 0.5;

    // Respiración sutil del ecuador y del núcleo.
    this.equatorMat.opacity = (0.8 + 0.2 * Math.sin(this.time * 1.4)) * this.dim;
    this.coreGlow.material.opacity = (0.28 + 0.1 * Math.sin(this.time * 1.1 + 1)) * this.dim;

    // Todo lo demás baja de intensidad de forma proporcional.
    for (const { mat, base } of this.fades) mat.opacity = base * this.dim;
    this.rimMat.uniforms.uIntensity.value = 0.9 * this.dim;
    for (const el of this.ketLabels) el.style.opacity = String(this.dim);
  }

  // ---------- construcción ----------

  /** Registra un material para que se atenúe al enfocar una sección. */
  private fade<T extends Fadeable>(mat: T, base = mat.opacity): T {
    mat.transparent = true;
    this.fades.push({ mat, base });
    return mat;
  }

  private buildShell(): THREE.ShaderMaterial {
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      this.fade(
        new THREE.MeshPhysicalMaterial({
          color: 0x0b1c2e,
          transparent: true,
          opacity: 0.16,
          roughness: 0.15,
          metalness: 0.1,
          depthWrite: false,
        }),
      ),
    );
    glass.renderOrder = -1;
    this.group.add(glass);

    const rimMat = fresnelMaterial(CYAN, 3.2, 0.9);
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(1.005, 64, 64), rimMat));
    return rimMat;
  }

  private buildGrid(): void {
    const pts: number[] = [];
    // Paralelos
    for (let lat = -75; lat <= 75; lat += 15) {
      const phi = THREE.MathUtils.degToRad(lat);
      const r = Math.cos(phi);
      const y = Math.sin(phi);
      const n = Math.max(28, Math.round(150 * r));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(r * Math.cos(a), y, r * Math.sin(a));
      }
    }
    // Meridianos (6 círculos máximos = 12 meridianos)
    for (let m = 0; m < 6; m++) {
      const yaw = (m / 6) * Math.PI;
      const n = 170;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(Math.cos(yaw) * Math.cos(a), Math.sin(a), Math.sin(yaw) * Math.cos(a));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = this.fade(
      new THREE.PointsMaterial({
        color: 0x8ff0ff,
        size: 0.015,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(new THREE.Points(geo, mat));
  }

  private buildEquator(): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9 });
    const eq = new THREE.Mesh(new THREE.TorusGeometry(1, 0.007, 8, 220), mat);
    eq.rotation.x = Math.PI / 2;
    this.group.add(eq);

    // Círculo punteado justo por fuera del ecuador
    const ring = new THREE.Points(
      circlePoints(1.08, 140),
      this.fade(
        new THREE.PointsMaterial({ color: 0xbff8ff, size: 0.018, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
      ),
    );
    this.group.add(ring);
    return mat;
  }

  /** Estados base |0⟩ y |1⟩ en los polos. */
  private buildKets(): void {
    const ket0 = makeLabel('|0⟩', 'ket-label');
    ket0.position.set(0, 1.14, 0);
    const ket1 = makeLabel('|1⟩', 'ket-label');
    ket1.position.set(0, -1.14, 0);
    this.ketLabels.push(ket0.element, ket1.element);
    this.group.add(ket0, ket1);
  }

  private buildHelix(): THREE.CatmullRomCurve3 {
    const pts: THREE.Vector3[] = [];
    const N = 400;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const r = 0.93 * Math.sin(Math.PI * t);
      const a = t * Math.PI * 6;
      pts.push(new THREE.Vector3(r * Math.cos(a), -0.94 + 1.88 * t, r * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 500, 0.011, 8, false),
      this.fade(new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.95 })),
    );
    this.group.add(tube);
    return curve;
  }

  private buildRunner(): THREE.Object3D {
    const runner = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 16),
      this.fade(new THREE.MeshBasicMaterial({ color: 0xffd9f7 }), 1),
    );
    runner.add(glowSprite('rgba(255,120,230,1)', 0.45, 0.9));
    this.group.add(runner);
    return runner;
  }

  private buildStateVector(): THREE.Group {
    const vector = new THREE.Group();
    const theta = 0.85; // ángulo polar del estado
    const arm = new THREE.Group();
    arm.rotation.z = -theta;

    const mat = this.fade(new THREE.MeshBasicMaterial({ color: 0xffffff }), 1);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.92, 8), mat);
    shaft.position.y = 0.46;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 12), mat);
    tip.position.y = 0.955;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 16, 16),
      this.fade(new THREE.MeshBasicMaterial({ color: 0xff7de9 }), 1),
    );
    head.position.y = 1;
    const headGlow = glowSprite('rgba(255,125,233,1)', 0.5, 0.9);
    this.fade(headGlow.material, 0.9);
    head.add(headGlow);
    arm.add(shaft, tip, head);
    vector.add(arm);

    // Proyecciones punteadas: punta → plano ecuatorial → centro
    const px = Math.sin(theta);
    const py = Math.cos(theta);
    const dashMat = this.fade(
      new THREE.LineDashedMaterial({ color: 0xff9be9, dashSize: 0.045, gapSize: 0.03, transparent: true, opacity: 0.7 }),
    );
    for (const [a, b] of [
      [new THREE.Vector3(px, py, 0), new THREE.Vector3(px, 0, 0)],
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(px, 0, 0)],
    ]) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), dashMat);
      line.computeLineDistances();
      vector.add(line);
    }

    this.group.add(vector);
    return vector;
  }
}
