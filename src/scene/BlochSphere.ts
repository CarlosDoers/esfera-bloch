import * as THREE from 'three';
import { easeTo, fresnelMaterial, glowSprite, makeLabel } from './helpers';
import { PALETTE } from '../palette';

/**
 * La esfera es estructura, no luz. Antes el ecuador, la hélice y el vector tiraban de
 * cian y magenta a tope y todo iba en aditivo: con la escena entera brillando no había
 * contra qué contrastar. Ahora el armazón va en el color de línea, la hélice y el vector
 * en texto, y el acento se reserva para el ecuador —que es lo que da sentido a la esfera—.
 */
const STRUCTURE = PALETTE.line;
const QUIET = PALETTE.quiet;
const ACCENT = PALETTE.accent;
const TEXT = PALETTE.text;
const REST_DIM = 0.16; // intensidad que conserva la esfera con una sección enfocada
/**
 * Entrada por fases: primero el armazón de la esfera —cristal, rejilla, ecuador—,
 * después la retícula del chip la va cubriendo (eso lo lleva `QubitLattice`) y al final
 * los estados base. La hélice y la flecha ya no entran aquí: aparecen al abrir una
 * sección, así que en reposo la esfera se queda quieta. Cada elemento guarda el segundo
 * en que empieza a aparecer.
 */
const REVEAL_SPAN = 0.7; // lo que tarda cada elemento en entrar
const AT_SHELL = 0.15;
const AT_EQUATOR = 0.35;
const AT_HELIX = 2.7;
const AT_KETS = 3;

const UP = new THREE.Vector3(0, 1, 0);

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
  private readonly vectorMats: THREE.MeshBasicMaterial[] = [];
  /** Hélice y fotón: 0 en reposo, 1 con una sección abierta. */
  private active = 0;
  /** Flecha: 0 oculta, 1 apuntando. Solo sube al señalar una subsección. */
  private aiming = 0;
  private readonly aim = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.rimMat = this.buildShell();
    this.buildGrid();
    this.buildKets();
    this.equatorMat = this.buildEquator();
    this.helix = this.buildHelix();
    this.runner = this.buildRunner();
    this.runnerGlow = this.runner.children[0] as THREE.Sprite;
    this.vector = this.buildStateVector();
  }

  /**
   * `focus` va de 0 (nada seleccionado) a 1 (sección enfocada: la esfera se atenúa).
   *
   * La hélice y su fotón **solo existen con una sección abierta**, y la flecha solo
   * cuando además se señala una subsección: en reposo la esfera está quieta y no
   * compite con nada.
   */
  update(dt: number, focus: number): void {
    this.time += dt;
    this.dim = 1 - (1 - REST_DIM) * focus;
    this.active = easeTo(this.active, focus > 0.5 ? 1 : 0, dt, 3.5);

    // Fotón recorriendo la hélice, solo con una sección abierta.
    const t = (this.time * 0.07) % 1;
    this.runner.position.copy(this.helix.getPointAt(t));
    this.runner.visible = this.active > 0.02;
    this.runnerGlow.material.opacity = (0.5 + 0.3 * Math.sin(this.time * 9)) * this.active;

    // La flecha apunta a la subsección señalada y se desvanece al soltarla.
    this.vector.visible = this.aiming > 0.02;
    if (this.vector.visible) {
      this.vector.quaternion.setFromUnitVectors(UP, this.aim);
      this.vector.scale.setScalar(this.aiming);
      for (const m of this.vectorMats) m.opacity = this.aiming;
    }

    this.equatorMat.opacity = 0.5 * this.dim * this.reveal(AT_EQUATOR); // sin respiración: no todo tiene que latir

    // Todo lo demás baja de intensidad de forma proporcional... salvo la hélice y su
    // fotón, que van atados a `active` y **no** a `dim`: pertenecen al estado abierto, así
    // que atenuarlos porque hay algo abierto sería justo al revés. Antes se llevaban las
    // dos penalizaciones a la vez —color de línea y `dim` al 16 %— y no se veían.
    for (const { mat, base, at } of this.fades) {
      mat.opacity = at === AT_HELIX ? base * this.active : base * this.dim * this.reveal(at);
    }
    this.rimMat.uniforms.uIntensity.value = 0.35 * this.dim * this.reveal(AT_SHELL);
    const kets = String(this.dim * this.reveal(AT_KETS));
    for (const el of this.ketLabels) el.style.opacity = kets;
  }

  /**
   * Dirección (local, normalizada) a la que apunta la flecha, o `null` para retirarla.
   * La llama `App` con la subsección que tenga el puntero encima.
   */
  setAim(dir: THREE.Vector3 | null): void {
    if (dir) this.aim.copy(dir).normalize();
    this.aiming = dir ? Math.min(1, this.aiming + 0.18) : Math.max(0, this.aiming - 0.12);
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
      // No va en color de línea como el resto del armazón: la hélice ya no es fondo,
      // es el camino que recorre el fotón y solo se ve con una sección abierta.
      this.fade(new THREE.MeshBasicMaterial({ color: QUIET, transparent: true, opacity: 0.95 }), 0.95, AT_HELIX),
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

  /**
   * El vector de estado, montado a lo largo de +Y para poder orientarlo a cualquier
   * dirección con un solo cuaternión. Antes iba con una inclinación fija y sus
   * proyecciones punteadas al plano ecuatorial; ahora es un puntero, así que las
   * proyecciones sobraban.
   */
  private buildStateVector(): THREE.Group {
    const vector = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: TEXT, transparent: true, opacity: 0 });
    this.vectorMats.push(mat);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 8), mat);
    shaft.position.y = 0.45;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.1, 14), mat);
    tip.position.y = 0.95;

    const headMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 });
    this.vectorMats.push(headMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 16), headMat);
    head.position.y = 1;

    vector.add(shaft, tip, head);
    vector.visible = false;
    this.group.add(vector);
    return vector;
  }
}
