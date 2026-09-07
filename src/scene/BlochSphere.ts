import * as THREE from 'three';
import { fresnelMaterial, glowSprite, makeLabel } from './helpers';
import { PALETTE } from '../palette';

/**
 * La esfera es estructura, no luz. Antes el ecuador, la hélice y el vector tiraban de
 * cian y magenta a tope y todo iba en aditivo: con la escena entera brillando no había
 * contra qué contrastar. Ahora el armazón va en el color de línea, la hélice y el vector
 * en texto, y el acento se reserva para el ecuador —que es lo que da sentido a la esfera—.
 */
const STRUCTURE = PALETTE.line;
const ACCENT = PALETTE.accent;
const TEXT = PALETTE.text;
const REST_DIM = 0.16; // intensidad que conserva la esfera con una sección enfocada
/**
 * Entrada por fases. Primero se dibuja el armazón de la esfera —cristal, rejilla,
 * ecuador—, después la retícula del chip la va cubriendo (eso lo lleva `QubitLattice`)
 * y al final llegan la hélice y el vector de estado, que son los que dan vida. Cada
 * elemento guarda el segundo en que empieza a aparecer.
 */
const REVEAL_SPAN = 0.7; // lo que tarda cada elemento en entrar
const AT_SHELL = 0.15;
const AT_EQUATOR = 0.35;
const AT_HELIX = 2.7;
const AT_VECTOR = 3;
const AT_KETS = 3.15;

type Fadeable = THREE.Material & { opacity: number };

/** Esfera de Bloch: rejilla punteada, ecuador, hélice y vector de estado. */
export class BlochSphere {
  readonly group = new THREE.Group();

  private time = 0;
  private dim = 1;
  private readonly fades: Array<{ mat: Fadeable; base: number; at: number }> = [];
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
    this.coreGlow = glowSprite('rgba(79,208,238,1)', 1.1, 0.12);
    this.group.add(this.coreGlow);
  }

  /** `focus` va de 0 (nada seleccionado) a 1 (sección enfocada: la esfera se atenúa). */
  update(dt: number, focus: number): void {
    this.time += dt;
    this.dim = 1 - (1 - REST_DIM) * focus;

    // Fotón recorriendo la hélice.
    const t = (this.time * 0.07) % 1;
    this.runner.position.copy(this.helix.getPointAt(t));
    this.runnerGlow.material.opacity = (0.6 + 0.4 * Math.sin(this.time * 9)) * this.dim * this.reveal(AT_HELIX);

    // Precesión de Larmor del vector de estado alrededor de Z.
    this.vector.rotation.y = this.time * 0.5;

    // Respiración sutil del ecuador y del núcleo.
    this.equatorMat.opacity = 0.5 * this.dim * this.reveal(AT_EQUATOR); // sin respiración: no todo tiene que latir
    this.coreGlow.material.opacity = 0.12 * this.dim * this.reveal(AT_VECTOR);

    // El vector de estado no aparece: crece desde el centro cuando le toca.
    this.vector.scale.setScalar(this.reveal(AT_VECTOR));

    // Todo lo demás baja de intensidad de forma proporcional.
    for (const { mat, base, at } of this.fades) mat.opacity = base * this.dim * this.reveal(at);
    this.rimMat.uniforms.uIntensity.value = 0.35 * this.dim * this.reveal(AT_SHELL);
    const kets = String(this.dim * this.reveal(AT_KETS));
    for (const el of this.ketLabels) el.style.opacity = kets;
  }

  // ---------- construcción ----------

  /** Registra un material para que se atenúe al enfocar una sección y entre en su turno. */
  private fade<T extends Fadeable>(mat: T, base = mat.opacity, at = AT_SHELL): T {
    mat.transparent = true;
    this.fades.push({ mat, base, at });
    return mat;
  }

  /** 0 antes de su turno, 1 cuando ha terminado de entrar. */
  private reveal(at: number): number {
    return THREE.MathUtils.smoothstep(this.time, at, at + REVEAL_SPAN);
  }

  private buildShell(): THREE.ShaderMaterial {
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      this.fade(
        new THREE.MeshPhysicalMaterial({
          color: 0x0a1018,
          transparent: true,
          opacity: 0.2,
          roughness: 0.15,
          metalness: 0.1,
          depthWrite: false,
        }),
      ),
    );
    glass.renderOrder = -1;
    this.group.add(glass);

    const rimMat = fresnelMaterial(ACCENT, 3.6, 0.35);
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(1.005, 64, 64), rimMat));
    return rimMat;
  }

  /**
   * Solo meridianos: los paralelos los pone ahora la propia retícula del chip, que se
   * tiende en bandas de latitud. 8 círculos máximos = 16 meridianos, uno por cada
   * columna de cúbits, así que las columnas caen exactamente sobre la rejilla.
   */
  private buildGrid(): void {
    const pts: number[] = [];
    for (let m = 0; m < 8; m++) {
      const yaw = (m / 8) * Math.PI;
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
        color: STRUCTURE,
        size: 0.014,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.group.add(new THREE.Points(geo, mat));
  }

  private buildEquator(): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 });
    const eq = new THREE.Mesh(new THREE.TorusGeometry(1, 0.007, 8, 220), mat);
    eq.rotation.x = Math.PI / 2;
    this.group.add(eq);

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
      this.fade(new THREE.MeshBasicMaterial({ color: STRUCTURE, transparent: true, opacity: 0.9 }), 0.9, AT_HELIX),
    );
    this.group.add(tube);
    return curve;
  }

  private buildRunner(): THREE.Object3D {
    const runner = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 16),
      this.fade(new THREE.MeshBasicMaterial({ color: TEXT }), 1, AT_HELIX),
    );
    runner.add(glowSprite('rgba(232,237,243,1)', 0.3, 0.5));
    this.group.add(runner);
    return runner;
  }

  private buildStateVector(): THREE.Group {
    const vector = new THREE.Group();
    const theta = 0.85; // ángulo polar del estado
    const arm = new THREE.Group();
    arm.rotation.z = -theta;

    const mat = this.fade(new THREE.MeshBasicMaterial({ color: 0xffffff }), 1, AT_VECTOR);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.92, 8), mat);
    shaft.position.y = 0.46;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 12), mat);
    tip.position.y = 0.955;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 16, 16),
      this.fade(new THREE.MeshBasicMaterial({ color: ACCENT }), 1, AT_VECTOR),
    );
    head.position.y = 1;
    const headGlow = glowSprite('rgba(79,208,238,1)', 0.34, 0.55);
    this.fade(headGlow.material, 0.9, AT_VECTOR);
    head.add(headGlow);
    arm.add(shaft, tip, head);
    vector.add(arm);

    // Proyecciones punteadas: punta → plano ecuatorial → centro
    const px = Math.sin(theta);
    const py = Math.cos(theta);
    const dashMat = this.fade(
      new THREE.LineDashedMaterial({ color: STRUCTURE, dashSize: 0.045, gapSize: 0.03, transparent: true, opacity: 0.9 }),
      0.7,
      AT_VECTOR,
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
