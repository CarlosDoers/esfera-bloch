import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Territory, SubItem } from '../menu';
import { easeTo, glowSprite, makeLabel } from './helpers';
import { bfsOrder, COLS, heavyHex, ROWS, type Topology } from './HeavyHex';

export type HitInfo =
  | { kind: 'item'; itemId: string }
  | { kind: 'sub'; itemId: string; subId: string }
  | { kind: 'qubit'; index: number };

const RADIUS = 1.02; // radio sobre el que se apoyan los cúbits
const BASE_SIZE = 0.016;
const HUB_SIZE = 0.05;
const SUB_SIZE = 0.046;
const SUB_ANGLE = 1.15; // separación angular respecto al eje de vista (rad)
const SUB_CLEARANCE = 0.2; // aire entre la silueta de la esfera y la corona, en radios
/**
 * En pantallas estrechas no hay sitio: la esfera ya ocupa dos tercios del ancho y una
 * corona por fuera echaría las etiquetas fuera del encuadre. Ahí se apoya por dentro,
 * como antes, y el panel se va abajo de todas formas.
 */
const SUB_CLEARANCE_NARROW = -0.35;
const NARROW_PX = 820;
/**
 * La corona cae sobre un cono a `SUB_ANGLE` del eje de la sección y, como la esfera gira
 * para encarar la sección, ese eje apunta a la cámara: en pantalla las subsecciones caen
 * sobre una circunferencia de radio `R·sen(SUB_ANGLE)` alrededor del centro de la esfera.
 * Para que no se solapen con ella ese radio tiene que superar la silueta (radio 1), así
 * que el despegue se **deduce** del ángulo y del aire que se quiere dejar, en vez de
 * fijarse a ojo y tener que recalcularlo a mano si cambia cualquiera de los dos.
 *
 * El cálculo es ortográfico y la perspectiva agranda algo la corona, porque queda más
 * cerca de la cámara que el centro de la esfera. Por eso `SUB_ANGLE` es grande: cuanto
 * más se acerca a 90°, menos se adelanta la corona y menos desvía la perspectiva. El
 * error restante va a favor —sobra aire, no falta—.
 */
const crownRadius = () =>
  (1 + (window.innerWidth < NARROW_PX ? SUB_CLEARANCE_NARROW : SUB_CLEARANCE)) / Math.sin(SUB_ANGLE);
const SUB_ARC_STEP = 0.7; // apertura de la corona por subsección (rad)
const SUB_ARC_MAX = 2; // apertura máxima de la corona (rad)
/**
 * Entrada. En vez de encender los cúbits por orden de índice, un **anillo de luz baja
 * del polo |0⟩ al polo |1⟩** y va encendiendo las bandas de la retícula a su paso: como
 * las filas del chip son paralelos, el barrido por latitud recorre el procesador fila a
 * fila y de paso enseña cómo está envuelto. Cada cúbit llega desde fuera de la esfera,
 * destella y se asienta con un rebote.
 */
const BOOT_LEAD = 0.5; // lo que se espera a que aparezca el armazón de la esfera
const BOOT_SWEEP = 2; // lo que tarda el anillo en bajar de polo a polo
const BOOT_RISE = 0.5; // lo que tarda un cúbit en llegar y encenderse
const BOOT_DROP = 0.3; // desde cuánto más lejos del centro llega, en radios
const POLE_GAP = 0.42; // radianes libres en cada polo, para |0⟩ y |1⟩
const REST_DIM = 0.16; // intensidad que conserva lo no seleccionado
const BASE_COLOR = new THREE.Color(0x8ff0ff);
/**
 * Luminancia objetivo para el color de un territorio en la escena 3D. El bloom recorta
 * por luminancia, y el rosa y el morado la tienen mucho más baja que el cian, el verde
 * o el ámbar —la luminancia la manda el canal verde—, así que con el mismo umbral
 * brillaban la tercera parte. Se sube su intensidad hasta igualarlos; el color de la
 * etiqueta y del panel no se toca, que ahí no interviene el bloom.
 */
const GLOW_LUMA = 0.8;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const LABEL_DROP = new THREE.Vector3(0, -0.14, 0);
const SUB_LABEL_BELOW = -0.12; // separacion vertical de la etiqueta bajo su cubit
const SUB_LABEL_ABOVE = 0.15; // ...y por encima, alternando para que no se pisen

interface Qubit {
  pos: THREE.Vector3; // hueco en la esfera
  /** Latitud normalizada, 0 en el polo |0⟩ y 1 en el |1⟩: marca su turno de encendido. */
  band: number;
  drawPos: THREE.Vector3; // posición dibujada (las subsecciones se despegan)
  seed: number;
  scale: number;
  targetScale: number;
  color: THREE.Color;
  targetColor: THREE.Color;
}

interface SubNode {
  sub: SubItem;
  index: number;
  hit: THREE.Mesh;
  label: CSS2DObject;
  /** Posición en la corona, 0 = arriba, negativo a la izquierda. */
  ang: number;
  /** Empujón vertical en pantalla para no pisar a otra etiqueta. */
  dy: number;
  lifted: THREE.Vector3;
}

interface Hub {
  item: Territory;
  index: number;
  color: THREE.Color;
  group: THREE.Group;
  ringMats: THREE.MeshBasicMaterial[];
  glow: THREE.Sprite;
  hit: THREE.Mesh;
  label: CSS2DObject;
  scale: number;
  active: number;
  subs: SubNode[];
}

const invisible = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/**
 * La retícula heavy-hex del IBM Quantum Heron —156 cúbits, 176 acopladores—
 * envuelta sobre la esfera: cada fila de 16 cúbits es un paralelo y los 28 cúbits
 * puente enlazan una banda con la siguiente. Los enlaces son los acopladores reales
 * y la numeración sigue el orden de IBM, así que `Q·042` es el cúbit 42 del chip.
 *
 * Las secciones del menú son cúbits destacados ("hubs"); al seleccionar uno, sus
 * cúbits **acoplados** se despegan de la esfera hacia fuera y muestran las
 * subsecciones. Nada orbita.
 */
export class QubitLattice {
  readonly group = new THREE.Group();

  private readonly topology: Topology = heavyHex();
  private readonly qubits: Qubit[] = [];
  private readonly hubs: Hub[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly hitMesh: THREE.InstancedMesh;
  private readonly links: THREE.LineSegments;
  private readonly linkBand: number[] = [];
  private readonly tooltip: CSS2DObject;
  /** Anillo de luz que baja de polo a polo encendiendo la retícula. */
  private readonly sweep: THREE.Mesh;
  private readonly sweepMat: THREE.MeshBasicMaterial;
  private hovered: HitInfo | null = null;
  private selectedId: string | null = null;
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly camLocal = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly nrm = new THREE.Vector3();
  private readonly tanU = new THREE.Vector3();
  private readonly tanV = new THREE.Vector3();
  private readonly crown = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(items: Territory[], readonly count: number) {
    const n = this.topology.nodes.length;
    if (n !== count) throw new Error(`La retícula tiene ${n} cúbits, se esperaban ${count}`);
    this.buildQubits();

    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      count,
    );
    this.hitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), invisible(), count);
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, BASE_COLOR);

    this.links = this.buildLinks();
    this.tooltip = makeLabel('', 'qubit-tip');
    this.tooltip.visible = false;

    // El anillo es un toro de radio 1 en el plano ecuatorial: subiendo o bajando en Y y
    // escalándolo recorre la esfera como un paralelo que se desplaza.
    this.sweepMat = new THREE.MeshBasicMaterial({
      color: 0xbdf6ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sweep = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 6, 120), this.sweepMat);
    this.sweep.rotation.x = Math.PI / 2;

    this.group.add(this.mesh, this.hitMesh, this.links, this.tooltip, this.sweep);
    this.buildHubs(items);
  }

  /** Cúbits ya "encendidos" durante la animación de arranque. */
  get booted(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.bootOf(i) > 0.5) n++;
    return n;
  }

  /** Mientras baja el anillo, el resto de la escena espera su turno. */
  get booting(): boolean {
    return this.time < BOOT_LEAD + BOOT_SWEEP + BOOT_RISE;
  }

  /** Avance del anillo de encendido, 0 en el polo |0⟩ y 1 en el |1⟩. */
  private get front(): number {
    return (this.time - BOOT_LEAD) / BOOT_SWEEP;
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Posición local del cúbit-sección (para orientar la esfera hacia él). */
  hubPosition(id: string): THREE.Vector3 | null {
    const hub = this.hubs.find((h) => h.item.id === id);
    return hub ? this.qubits[hub.index].pos : null;
  }

  hitTargets(): THREE.Object3D[] {
    const sel = this.hubs.find((h) => h.item.id === this.selectedId);
    return [...this.hubs.map((h) => h.hit), ...(sel?.subs.map((s) => s.hit) ?? []), this.hitMesh];
  }

  resolveHit(hit: THREE.Intersection): HitInfo | null {
    if (hit.object === this.hitMesh) {
      return hit.instanceId === undefined ? null : { kind: 'qubit', index: hit.instanceId };
    }
    const data = hit.object.userData as Partial<HitInfo>;
    return data.kind ? (data as HitInfo) : null;
  }

  setHovered(hit: HitInfo | null): void {
    if (sameHit(hit, this.hovered)) return;
    this.toggleHover(this.hovered, false);
    this.hovered = hit;
    this.toggleHover(hit, true);
    if (hit?.kind === 'qubit') {
      (this.tooltip.element.firstChild as HTMLElement).textContent = `Q·${String(hit.index).padStart(3, '0')}`;
    }
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const hub of this.hubs) {
      hub.label.element.classList.toggle('selected', hub.item.id === id);
      hub.label.element.classList.toggle('dim', id !== null && hub.item.id !== id);
    }
  }

  /** `focus` va de 0 (nada seleccionado) a 1 (sección enfocada). */
  update(dt: number, camWorld: THREE.Vector3, focus: number): void {
    this.time += dt;

    // Todo lo que no pertenece a la sección enfocada baja de intensidad.
    const rest = 1 - (1 - REST_DIM) * focus;
    (this.links.material as THREE.LineBasicMaterial).opacity = 0.42 * rest;

    // Acopladores ya encendidos: los que el anillo ha dejado atrás (van ordenados por
    // la latitud del extremo más bajo, así que basta con contar desde el principio).
    const front = this.front;
    let n = 0;
    while (n < this.linkBand.length && this.linkBand[n] < front) n++;
    this.links.geometry.setDrawRange(0, n * 2);

    this.updateSweep();

    this.camLocal.copy(camWorld);
    this.group.worldToLocal(this.camLocal);
    const hoverIndex = this.hoverIndex();
    const crownR = crownRadius();

    // Estado por defecto de la retícula; las secciones lo sobrescriben abajo.
    for (const q of this.qubits) {
      q.targetScale = BASE_SIZE;
      q.targetColor.copy(BASE_COLOR).multiplyScalar(rest);
    }

    for (const hub of this.hubs) {
      const isSel = hub.item.id === this.selectedId;
      const isHover = this.hovered?.kind === 'item' && this.hovered.itemId === hub.item.id;
      const boot = this.bootOf(hub.index);
      const k = isSel ? 1 : rest; // la sección enfocada conserva su color
      const hubPos = this.qubits[hub.index].pos;

      hub.scale = easeTo(hub.scale, isSel ? 1.3 : isHover ? 1.2 : 1, dt, 8);
      hub.active = easeTo(hub.active, isSel ? 1 : 0, dt, 5);
      hub.group.visible = boot > 0.01;
      hub.group.scale.setScalar(hub.scale * boot);
      hub.ringMats[0].opacity = 0.9 * k;
      hub.ringMats[1].opacity = 0.35 * k;
      hub.glow.material.opacity = 0.6 * k * (isSel || isHover ? 1.15 : 1);
      this.qubits[hub.index].targetScale = HUB_SIZE * hub.scale;
      this.qubits[hub.index].targetColor.copy(hub.color).multiplyScalar(k);
      this.faceLabel(hub.label, hubPos, boot > 0.5);

      // Marco tangente al eje de la cámara: `tanV` apunta hacia arriba en pantalla y
      // `tanU` hacia la derecha. Se toma el eje de vista y no el del cúbit de la sección
      // porque `focusOn` solo iguala el azimut: una sección por debajo del ecuador queda
      // hasta 25° fuera de eje y su corona se descentraría de la silueta de la esfera,
      // que es justo lo que hay que evitar.
      this.nrm.copy(this.camLocal).normalize();
      this.tanV.copy(UP).addScaledVector(this.nrm, -UP.dot(this.nrm));
      if (this.tanV.lengthSq() < 1e-6) this.tanV.copy(FORWARD); // sección justo en un polo
      this.tanV.normalize();
      this.tanU.crossVectors(this.tanV, this.nrm);

      hub.subs.forEach((s, j) => {
        const q = this.qubits[s.index];
        const a = hub.active;
        q.targetScale = BASE_SIZE + (SUB_SIZE - BASE_SIZE) * a;
        q.targetColor.copy(BASE_COLOR).multiplyScalar(rest).lerp(hub.color, a);

        // Sitio de destino: corona sobre el cúbit de la sección, de izquierda a derecha
        // en el mismo orden que el panel. El cúbit viaja hasta ahí desde su hueco real.
        // No se dibuja ninguna línea: lo que agrupa las subsecciones con su sección es
        // el color y la cercanía.
        this.crown
          .copy(this.nrm)
          .multiplyScalar(Math.cos(SUB_ANGLE))
          .addScaledVector(this.tanU, Math.sin(s.ang) * Math.sin(SUB_ANGLE))
          .addScaledVector(this.tanV, Math.cos(s.ang) * Math.sin(SUB_ANGLE))
          .multiplyScalar(crownR);
        s.lifted.copy(q.pos).lerp(this.crown, a);
        q.drawPos.copy(s.lifted);

        s.hit.position.copy(s.lifted);
        s.hit.visible = isSel;

        // En una corona las etiquetas centrales quedan casi a la misma altura y se
        // pisan entre si, asi que se alternan por encima y por debajo de su cubit.
        s.label.position.copy(s.lifted).addScaledVector(UP, j % 2 ? SUB_LABEL_ABOVE : SUB_LABEL_BELOW);
        this.faceLabel(s.label, s.lifted, isSel && a > 0.6);
      });
      if (isSel) this.separateLabels(hub, dt);
    }

    this.qubits.forEach((q, i) => {
      q.scale = easeTo(q.scale, q.targetScale * (i === hoverIndex ? 1.6 : 1), dt, 8);
      q.color.lerp(q.targetColor, Math.min(1, dt * 6));
      const pulse = 1 + 0.18 * Math.sin(this.time * 2.4 + q.seed);
      const boot = this.bootOf(i);

      // Llega desde fuera de la esfera y se posa con un rebote, con un destello al pasar.
      this.dummy.position.copy(q.drawPos).multiplyScalar(1 + BOOT_DROP * (1 - backOut(boot)));
      this.dummy.scale.setScalar(q.scale * boot * pulse);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const ignition = 4 * boot * (1 - boot);
      this.mesh.setColorAt(i, this.tmpColor.copy(q.color).multiplyScalar(1 + 3 * ignition));
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.hitMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.hitMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    if (this.hovered?.kind === 'qubit') {
      this.tooltip.position.copy(this.qubits[this.hovered.index].drawPos).multiplyScalar(1.12);
      this.tooltip.visible = true;
    } else {
      this.tooltip.visible = false;
    }
  }

  // ---------- construcción ----------

  /**
   * Envuelve la retícula plana sobre la esfera: la columna da la longitud (16 columnas
   * = 16 meridianos, los mismos que dibuja la rejilla de la esfera) y la fila la latitud.
   * Los cúbits puente caen a media banda. `POLE_GAP` deja los casquetes libres para los
   * estados base. La retícula del chip es abierta, así que entre la columna 15 y la 0
   * queda una costura sin acoplador: es así en la máquina real.
   */
  private buildQubits(): void {
    for (const node of this.topology.nodes) {
      const band = (node.row + (node.bridge ? 0.5 : 0)) / (ROWS - 1); // 0 = polo |0⟩, 1 = polo |1⟩
      const theta = POLE_GAP + band * (Math.PI - 2 * POLE_GAP);
      const phi = (node.col / COLS) * Math.PI * 2;
      const r = Math.sin(theta);
      const pos = new THREE.Vector3(r * Math.sin(phi), Math.cos(theta), r * Math.cos(phi)).multiplyScalar(RADIUS);
      this.qubits.push({
        pos,
        band,
        drawPos: pos.clone(),
        seed: Math.random() * Math.PI * 2,
        scale: BASE_SIZE,
        targetScale: BASE_SIZE,
        color: BASE_COLOR.clone(),
        targetColor: BASE_COLOR.clone(),
      });
    }
  }

  /** Los 176 acopladores reales del Heron, ordenados por latitud para el barrido. */
  private buildLinks(): THREE.LineSegments {
    const sorted = this.topology.edges
      .map(([a, b]) => ({ a, b, band: Math.max(this.qubits[a].band, this.qubits[b].band) }))
      .sort((p, q) => p.band - q.band);
    const arr = new Float32Array(sorted.length * 6);
    sorted.forEach(({ a, b, band }, k) => {
      this.qubits[a].pos.toArray(arr, k * 6);
      this.qubits[b].pos.toArray(arr, k * 6 + 3);
      this.linkBand.push(band);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.setDrawRange(0, 0);
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x5fd4ee, transparent: true, opacity: 0.42 }));
  }

  private buildHubs(items: Territory[]): void {
    const used = new Set<number>();

    // Un cúbit por sección, repartidos en azimut y alternando hemisferios. Nunca un
    // cúbit puente: son de grado 2 y quedarían con muy pocos vecinos para las subsecciones.
    const hubIndex = items.map((_, k) => {
      const az = (k / items.length) * Math.PI * 2 + 0.6;
      const lat = k % 2 === 0 ? 0.32 : -0.2;
      this.tmp.set(Math.cos(lat) * Math.sin(az), Math.sin(lat), Math.cos(lat) * Math.cos(az)).multiplyScalar(RADIUS);
      const idx = this.nearest(this.tmp, used, true);
      used.add(idx);
      return idx;
    });

    items.forEach((item, k) => {
      const index = hubIndex[k];
      const q = this.qubits[index];
      const color = balanceGlow(item.color);
      q.scale = q.targetScale = HUB_SIZE;
      q.color.copy(color);
      q.targetColor.copy(color);

      const group = new THREE.Group();
      group.position.copy(q.pos);
      group.quaternion.setFromUnitVectors(FORWARD, this.tmp.copy(q.pos).normalize());
      group.visible = false;

      const ringMats = [
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
      ];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.007, 8, 48), ringMats[0]);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.003, 6, 64), ringMats[1]);
      const glow = glowSprite(toRgba(new THREE.Color(item.color)), 0.55, 0.6);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), invisible());
      hit.userData = { kind: 'item', itemId: item.id } satisfies HitInfo;
      group.add(ring, ring2, glow, hit);

      const label = makeLabel(item.label, 'hub-label', item.color);
      label.position.copy(q.pos).multiplyScalar(1.2).add(LABEL_DROP); // hacia fuera y un poco por debajo
      this.group.add(group, label);

      // Subsecciones: los cúbits acoplados al de la sección, por cercanía en el mapa
      // (saltos por los acopladores reales, no distancia en línea recta).
      const n = item.items.length;
      const arc = n > 1 ? Math.min(SUB_ARC_MAX, SUB_ARC_STEP * (n - 1)) : 0;

      const subs = bfsOrder(this.topology, index)
        .filter((i) => !used.has(i))
        .slice(0, item.items.length)
        .map((idx, k2) => {
        const sub = item.items[k2];
        const ang = n > 1 ? -arc / 2 + (k2 / (n - 1)) * arc : 0;
        used.add(idx);
        const shit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), invisible());
        shit.visible = false;
        shit.userData = { kind: 'sub', itemId: item.id, subId: sub.id } satisfies HitInfo;
        const slabel = makeLabel(sub.label, 'sub-label', item.color);
        slabel.visible = false;
        // Las etiquetas son anchas: centradas sobre su cúbit se meterían por encima de
        // la esfera. Se alinean hacia fuera —la de la derecha crece a la derecha y la de
        // la izquierda a la izquierda— con un porcentaje de su propio ancho, para que
        // valga sea cual sea la longitud del texto.
        (slabel.element.firstElementChild as HTMLElement).style.setProperty(
          '--dx',
          `${(Math.sin(ang) * 50).toFixed(0)}%`,
        );
        this.group.add(shit, slabel);
        return { sub, index: idx, hit: shit, label: slabel, ang, dy: 0, lifted: this.qubits[idx].pos.clone() };
      });

      this.hubs.push({ item, index, color, group, ringMats, glow, hit, label, scale: 1, active: 0, subs });
    });
  }

  private nearest(target: THREE.Vector3, exclude: Set<number>, skipBridges = false): number {
    let best = -1;
    let bestD = Infinity;
    this.qubits.forEach((q, i) => {
      if (exclude.has(i)) return;
      if (skipBridges && this.topology.nodes[i].bridge) return;
      const d = q.pos.distanceToSquared(target);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ---------- utilidades ----------

  /**
   * Red de seguridad: la corona reparte las etiquetas y la alternancia arriba/abajo las
   * separa, pero eso depende del texto y del encuadre. Si dos llegan a pisarse se empuja
   * la de arriba lo justo, suavizado. No se nota y garantiza que se lean aunque cambie
   * el contenido del menú.
   */
  private separateLabels(hub: Hub, dt: number): void {
    const GAP = 6;
    const boxes = hub.subs
      .filter((s) => s.label.visible)
      .map((s) => {
        const r = (s.label.element.firstElementChild as HTMLElement).getBoundingClientRect();
        return { s, left: r.left, right: r.right, top: r.top - s.dy, height: r.height, target: 0 };
      })
      .filter((b) => b.height > 0)
      .sort((a, b) => a.top - b.top);

    // De abajo arriba: cada etiqueta empuja a las que tenga encima y se le monten.
    for (let k = boxes.length - 1; k >= 0; k--) {
      const lower = boxes[k];
      const lowerTop = lower.top + lower.target;
      for (let m = k - 1; m >= 0; m--) {
        const upper = boxes[m];
        if (upper.right < lower.left || upper.left > lower.right) continue;
        const upperBottom = upper.top + upper.target + upper.height;
        if (upperBottom + GAP > lowerTop) upper.target = lowerTop - GAP - upper.height - upper.top;
      }
    }

    for (const s of hub.subs) {
      const box = boxes.find((b) => b.s === s);
      s.dy = easeTo(s.dy, box ? box.target : 0, dt, 12);
      (s.label.element.firstElementChild as HTMLElement).style.setProperty('--dy', `${s.dy.toFixed(1)}px`);
    }
  }

  /**
   * Coloca el anillo de encendido en su latitud. Aparece justo antes de empezar el
   * barrido y se apaga al llegar al polo |1⟩; después ya no se dibuja.
   */
  private updateSweep(): void {
    const p = this.front;
    if (p < -0.25 || p > 1.35) {
      this.sweep.visible = false;
      return;
    }
    this.sweep.visible = true;
    const theta = POLE_GAP + THREE.MathUtils.clamp(p, 0, 1) * (Math.PI - 2 * POLE_GAP);
    this.sweep.position.y = Math.cos(theta) * RADIUS;
    this.sweep.scale.setScalar(Math.max(0.02, Math.sin(theta) * RADIUS * 1.03));
    // Entra y sale con suavidad para que no aparezca ni desaparezca de golpe.
    this.sweepMat.opacity = 0.9 * THREE.MathUtils.smoothstep(p, -0.25, 0.05) * (1 - THREE.MathUtils.smoothstep(p, 1, 1.35));
  }

  private bootOf(i: number): number {
    return THREE.MathUtils.smoothstep((this.front - this.qubits[i].band) / (BOOT_RISE / BOOT_SWEEP), 0, 1);
  }

  /** Oculta/atenúa una etiqueta según mire o no hacia la cámara. */
  private faceLabel(label: CSS2DObject, pos: THREE.Vector3, enabled: boolean): void {
    const f = this.tmp.copy(this.camLocal).sub(pos).normalize().dot(pos) / pos.length();
    label.visible = enabled && f > 0.05;
    label.element.style.opacity = String(THREE.MathUtils.clamp((f - 0.05) / 0.3, 0, 1));
  }

  private hoverIndex(): number {
    const h = this.hovered;
    if (!h || h.kind === 'item') return -1;
    if (h.kind === 'qubit') return h.index;
    return this.hubs.find((x) => x.item.id === h.itemId)?.subs.find((s) => s.sub.id === h.subId)?.index ?? -1;
  }

  private toggleHover(hit: HitInfo | null, on: boolean): void {
    if (!hit || hit.kind === 'qubit') return;
    const hub = this.hubs.find((x) => x.item.id === hit.itemId);
    if (!hub) return;
    if (hit.kind === 'item') hub.label.element.classList.toggle('hover', on);
    else hub.subs.find((s) => s.sub.id === hit.subId)?.label.element.classList.toggle('hover', on);
  }
}

/** Suavizado con rebote: el cúbit se pasa un poco de su sitio y vuelve. */
function backOut(t: number): number {
  const u = t - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
}

function sameHit(a: HitInfo | null, b: HitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'qubit' && b.kind === 'qubit') return a.index === b.index;
  if (a.kind === 'sub' && b.kind === 'sub') return a.itemId === b.itemId && a.subId === b.subId;
  if (a.kind === 'item' && b.kind === 'item') return a.itemId === b.itemId;
  return false;
}

/** Sube la intensidad de un color hasta `GLOW_LUMA` para que todos florezcan igual. */
function balanceGlow(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return c.multiplyScalar(Math.max(1, GLOW_LUMA / Math.max(luma, 1e-3)));
}

function toRgba(c: THREE.Color): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},1)`;
}
