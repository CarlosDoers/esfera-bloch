import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { QUBIT_COUNT, type Territory, type SubItem } from '../menu';
import type { Overlay } from '../ui/Overlay';
import { BlochSphere } from './BlochSphere';
import { easeTo } from './helpers';
import { QubitLattice, type HitInfo } from './QubitLattice';
import { PALETTE } from '../palette';

/** Altura del centro de la esfera sobre el suelo. */
export const SPHERE_Y = 1.6;
/** Cuánto se corre la esfera a la izquierda al enfocar, para dejar sitio al panel. */
const FOCUS_SHIFT = 0.55;
/** Por debajo de este ancho el panel se va abajo y la esfera necesita todo el sitio. */
const NARROW_PX = 820;
/** Retirada de cámara de la entrada: acompaña al barrido que enciende la retícula. */
const INTRO_SECONDS = 3.6;
const INTRO_ZOOM = 0.52; // arranca a la mitad de distancia...
const INTRO_LIFT = 0.35; // ...y más baja, casi al nivel del ecuador

export class App {
  /** Se invoca al pulsar una subsección (cúbit 3D o botón del panel). */
  onNavigate: (item: Territory, sub: SubItem) => void = () => {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-2, -2);
  private readonly downPos = new THREE.Vector2();
  private readonly center = new THREE.Vector3(0, SPHERE_Y, 0);
  private readonly camWorld = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private pointerInside = false;
  private focusYaw: number | null = null;
  private lastCount = -1;
  /** Entrada: de dónde sale la cámara, a dónde llega y por dónde va (0..1). */
  private readonly introFrom = new THREE.Vector3();
  private readonly introTo = new THREE.Vector3();
  private introT = 0;
  /** Territorio señalado desde el raíl HTML cuando el puntero no está sobre la escena. */
  private railHover: HitInfo | null = null;

  private readonly sphere: BlochSphere;
  private readonly lattice: QubitLattice;

  /** 0 = vista general, 1 = una sección enfocada (el resto se atenúa). */
  private focus = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly items: Territory[],
    private readonly overlay: Overlay,
  ) {
    const w = container.clientWidth;
    const h = container.clientHeight;

    // --- renderers ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.appendChild(this.labelRenderer.domElement);

    // --- escena / cámara ---
    // Fondo plano y sin niebla: fuera el campo de estrellas y el suelo espejo con
    // rejilla infinita. Eran los clichés de "escena 3D" más reconocibles y competían
    // con lo único que importa, que es el objeto.
    this.scene.background = new THREE.Color(PALETTE.bg);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camera.position.set(3.9, 3.0, -3.9);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.center);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 11;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;

    // --- luces (solo afectan al cristal de la esfera) ---
    this.scene.add(new THREE.AmbientLight(0x6688aa, 0.6));
    const cyan = new THREE.PointLight(0x5fe8ff, 6, 20, 2);
    cyan.position.copy(this.center);
    this.scene.add(cyan);

    // --- objetos ---
    this.sphere = new BlochSphere();
    this.sphere.group.position.copy(this.center);
    this.lattice = new QubitLattice(items, QUBIT_COUNT);
    this.sphere.group.add(this.lattice.group); // gira junto con la esfera
    this.scene.add(this.sphere.group);

    // --- postprocesado ---
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Umbral alto: el bloom deja de ser ambiente y solo alcanza a lo seleccionado.
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.8, 0.62));
    this.composer.addPass(new OutputPass());

    this.fitCamera();
    // Entrada: la cámara empieza cerca y baja, y se retira mientras el anillo de
    // encendido recorre la esfera. El autogiro espera a que termine.
    this.introTo.copy(this.camera.position);
    this.introFrom
      .copy(this.camera.position)
      .sub(this.center)
      .multiplyScalar(INTRO_ZOOM)
      .add(this.center);
    this.introFrom.y = this.center.y + (this.introFrom.y - this.center.y) * INTRO_LIFT;
    this.camera.position.copy(this.introFrom);
    this.controls.autoRotate = false;

    this.bindEvents();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /**
   * Aleja la cámara lo justo para que la esfera entre por el lado más estrecho del
   * encuadre. Sin esto, en vertical (móvil, tótem) la esfera se sale por los bordes.
   * Solo empuja hacia fuera: el encuadre de escritorio y el zoom manual no se tocan.
   */
  private fitCamera(): void {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const need = 1.5 / Math.tan(Math.min(vFov, hFov) / 2); // radio 1 + margen
    if (this.camera.position.distanceTo(this.controls.target) < need) {
      this.camera.position.sub(this.controls.target).setLength(need).add(this.controls.target);
    }
  }

  select(id: string | null): void {
    this.introT = 1; // pulsar durante la entrada la da por terminada
    this.lattice.select(id);
    const item = this.items.find((i) => i.id === id);
    if (item) {
      this.overlay.showItem(item);
      this.focusOn(item.id);
    } else {
      this.overlay.hide();
    }
    this.controls.autoRotate = !item;
  }

  /** Gira la esfera para que la sección seleccionada quede frente a la cámara. */
  private focusOn(id: string): void {
    const p = this.lattice.hubPosition(id);
    if (!p) return;
    const camAz = Math.atan2(this.camera.position.x, this.camera.position.z);
    const hubAz = Math.atan2(p.x, p.z);
    this.focusYaw = camAz - hubAz;
  }

  // ---------- bucle ----------

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);

    if (this.focusYaw !== null) {
      const cur = this.sphere.group.rotation.y;
      const delta = Math.atan2(Math.sin(this.focusYaw - cur), Math.cos(this.focusYaw - cur));
      this.sphere.group.rotation.y = cur + delta * Math.min(1, dt * 3.5);
      if (Math.abs(delta) < 0.003) this.focusYaw = null;
    }

    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / INTRO_SECONDS);
      const k = this.introT * this.introT * (3 - 2 * this.introT);
      this.camera.position.lerpVectors(this.introFrom, this.introTo, k);
      if (this.introT >= 1 && !this.lattice.selected) this.controls.autoRotate = true;
    }

    this.focus = easeTo(this.focus, this.lattice.selected ? 1 : 0, dt, 4);

    // La esfera se aparta a la izquierda mientras hay panel abierto.
    const camDir = this.tmpA.copy(this.camera.position).sub(this.center);
    this.tmpB.set(camDir.z, 0, -camDir.x).normalize(); // derecha horizontal en pantalla
    const shift = window.innerWidth < NARROW_PX ? 0 : FOCUS_SHIFT;
    this.controls.target.copy(this.center).addScaledVector(this.tmpB, shift * this.focus);

    this.camera.getWorldPosition(this.camWorld);
    this.sphere.update(dt, this.focus);
    this.lattice.update(dt, this.camWorld, this.focus);

    const hit = this.pointerInside ? this.pick() : this.railHover;
    this.lattice.setHovered(hit);
    this.container.classList.toggle('is-hover', hit !== null && hit.kind !== 'qubit');

    if (this.lattice.booted !== this.lastCount) {
      this.lastCount = this.lattice.booted;
      this.overlay.setQubitCount(this.lastCount);
    }

    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** Primer impacto que mire hacia la cámara (ignora la cara oculta de la esfera). */
  private pick(): HitInfo | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.lattice.hitTargets(), false)) {
      const info = this.lattice.resolveHit(hit);
      if (!info) continue;
      const normal = this.tmpA.copy(hit.point).sub(this.center).normalize();
      const toCam = this.tmpB.copy(this.camera.position).sub(hit.point).normalize();
      if (normal.dot(toCam) < 0.05) continue;
      return info;
    }
    return null;
  }

  // ---------- eventos ----------

  private bindEvents(): void {
    const el = this.renderer.domElement;

    el.addEventListener('pointermove', (e) => {
      this.pointerInside = true;
      this.updatePointer(e);
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
    });
    el.addEventListener('pointerdown', (e) => this.downPos.set(e.clientX, e.clientY));
    el.addEventListener('pointerup', (e) => {
      if (this.downPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 6) return; // era un arrastre
      this.pointerInside = true;
      this.updatePointer(e);
      this.handleClick(this.pick());
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
    });
    window.addEventListener('resize', () => this.resize());

    this.overlay.onClose = () => this.select(null);
    this.overlay.onSubClick = (item, sub) => this.onNavigate(item, sub);
    this.overlay.onRailClick = (item) => this.select(item?.id ?? null);
    this.overlay.onRailHover = (item) => {
      this.railHover = item ? { kind: 'item', itemId: item.id } : null;
    };
  }

  private handleClick(hit: HitInfo | null): void {
    if (!hit || hit.kind === 'qubit') {
      if (this.lattice.selected) this.select(null);
      return;
    }
    if (hit.kind === 'item') {
      this.select(hit.itemId);
      return;
    }
    const item = this.items.find((i) => i.id === hit.itemId);
    const sub = item?.items.find((s) => s.id === hit.subId);
    if (item && sub) this.onNavigate(item, sub);
  }

  private updatePointer(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.fitCamera();
  }
}
