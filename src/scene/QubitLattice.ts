import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Territory, SubItem } from '../menu';
import { easeTo, glowSprite, makeLabel } from './helpers';

export type HitInfo =
  | { kind: 'item'; itemId: string }
  | { kind: 'sub'; itemId: string; subId: string }
  | { kind: 'qubit'; index: number };

const RADIUS = 1.02; // radio sobre el que se apoyan los cúbits
const BASE_SIZE = 0.016;
const HUB_SIZE = 0.05;
const SUB_SIZE = 0.046;
const SUB_LIFT = 0.45; // cuánto se despegan las subsecciones (fracción del radio)
const SUB_SPREAD = 0.7; // cuánto se separan del cúbit de sección al despegarse
const BOOT_RATE = 60; // cúbits por segundo durante el arranque
const NEIGHBOURS = 3; // enlaces por cúbit (mapa de acoplamiento)
const REST_DIM = 0.16; // intensidad que conserva lo no seleccionado
const BASE_COLOR = new THREE.Color(0x8ff0ff);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const LABEL_DROP = new THREE.Vector3(0, -0.14, 0);
const SUB_LABEL_DROP = new THREE.Vector3(0, -0.1, 0);

interface Qubit {
  pos: THREE.Vector3; // hueco en la esfera
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
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  label: CSS2DObject;
  link: THREE.Mesh; // sección → subsección
  tether: THREE.Mesh; // hueco original → subsección despegada
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
const linkGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

/**
 * Los 156 cúbits repartidos sobre la esfera (espiral de Fibonacci) y enlazados
 * con sus vecinos. Las secciones del menú son cúbits destacados ("hubs");
 * al seleccionar uno, sus cúbits vecinos se despegan de la esfera hacia fuera
 * y muestran las subsecciones. Nada orbita.
 */
export class QubitLattice {
  readonly group = new THREE.Group();

  private readonly qubits: Qubit[] = [];
  private readonly hubs: Hub[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly hitMesh: THREE.InstancedMesh;
  private readonly links: THREE.LineSegments;
  private readonly linkMaxIndex: number[] = [];
  private readonly tooltip: CSS2DObject;
  private hovered: HitInfo | null = null;
  private selectedId: string | null = null;
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly camLocal = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(items: Territory[], readonly count: number) {
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

    this.group.add(this.mesh, this.hitMesh, this.links, this.tooltip);
    this.buildHubs(items);
  }

  /** Cúbits ya "encendidos" durante la animación de arranque. */
  get booted(): number {
    return Math.min(this.count, Math.floor(this.time * BOOT_RATE));
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
    (this.links.material as THREE.LineBasicMaterial).opacity = 0.22 * rest;

    // Enlaces que ya se pueden mostrar (ordenados por índice máximo).
    const booted = this.booted;
    let n = 0;
    while (n < this.linkMaxIndex.length && this.linkMaxIndex[n] < booted) n++;
    this.links.geometry.setDrawRange(0, n * 2);

    this.camLocal.copy(camWorld);
    this.group.worldToLocal(this.camLocal);
    const hoverIndex = this.hoverIndex();

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

      for (const s of hub.subs) {
        const q = this.qubits[s.index];
        const a = hub.active;
        q.targetScale = BASE_SIZE + (SUB_SIZE - BASE_SIZE) * a;
        q.targetColor.copy(BASE_COLOR).multiplyScalar(rest).lerp(hub.color, a);

        // Se despega de la esfera: hacia fuera y alejándose del cúbit de sección.
        s.lifted
          .copy(q.pos)
          .addScaledVector(this.tmp.copy(q.pos).sub(hubPos), SUB_SPREAD * a)
          .normalize()
          .multiplyScalar(RADIUS * (1 + SUB_LIFT * a));
        q.drawPos.copy(s.lifted);

        s.hit.position.copy(s.lifted);
        s.hit.visible = isSel;

        s.ring.position.copy(s.lifted);
        s.ring.quaternion.setFromUnitVectors(FORWARD, this.tmp.copy(s.lifted).normalize());
        s.ring.scale.setScalar(a);
        s.ring.visible = a > 0.02;
        s.ringMat.opacity = 0.9 * a;

        const on = a > 0.02;
        s.link.visible = on;
        s.tether.visible = on;
        if (on) {
          orientLink(s.link, hubPos, s.lifted, 0.007 * a);
          orientLink(s.tether, q.pos, s.lifted, 0.0025 * a);
          (s.link.material as THREE.MeshBasicMaterial).opacity = a;
          (s.tether.material as THREE.MeshBasicMaterial).opacity = 0.4 * a;
        }

        s.label.position.copy(s.lifted).add(SUB_LABEL_DROP);
        this.faceLabel(s.label, s.lifted, isSel && a > 0.6);
      }
    }

    this.qubits.forEach((q, i) => {
      q.scale = easeTo(q.scale, q.targetScale * (i === hoverIndex ? 1.6 : 1), dt, 8);
      q.color.lerp(q.targetColor, Math.min(1, dt * 6));
      const pulse = 1 + 0.18 * Math.sin(this.time * 2.4 + q.seed);
      this.dummy.position.copy(q.drawPos);
      this.dummy.scale.setScalar(q.scale * this.bootOf(i) * pulse);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, q.color);
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

  private buildQubits(): void {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < this.count; i++) {
      const y = 1 - ((i + 0.5) * 2) / this.count;
      const r = Math.sqrt(1 - y * y);
      const a = i * golden;
      const pos = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(RADIUS);
      this.qubits.push({
        pos,
        drawPos: pos.clone(),
        seed: Math.random() * Math.PI * 2,
        scale: BASE_SIZE,
        targetScale: BASE_SIZE,
        color: BASE_COLOR.clone(),
        targetColor: BASE_COLOR.clone(),
      });
    }
  }

  private buildLinks(): THREE.LineSegments {
    const pairs = new Map<string, [number, number]>();
    this.qubits.forEach((q, i) => {
      const near = this.qubits
        .map((o, j) => ({ j, d: o.pos.distanceToSquared(q.pos) }))
        .filter((e) => e.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, NEIGHBOURS);
      for (const { j } of near) {
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        pairs.set(`${a}-${b}`, [a, b]);
      }
    });
    const sorted = [...pairs.values()].sort((p, q) => p[1] - q[1]);
    const arr = new Float32Array(sorted.length * 6);
    sorted.forEach(([a, b], k) => {
      this.qubits[a].pos.toArray(arr, k * 6);
      this.qubits[b].pos.toArray(arr, k * 6 + 3);
      this.linkMaxIndex.push(b);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.setDrawRange(0, 0);
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x5fd4ee, transparent: true, opacity: 0.22 }));
  }

  private buildHubs(items: Territory[]): void {
    const used = new Set<number>();

    // Un cúbit por sección, repartidos en azimut y alternando hemisferios.
    const hubIndex = items.map((_, k) => {
      const az = (k / items.length) * Math.PI * 2 + 0.6;
      const lat = k % 2 === 0 ? 0.32 : -0.2;
      this.tmp.set(Math.cos(lat) * Math.sin(az), Math.sin(lat), Math.cos(lat) * Math.cos(az)).multiplyScalar(RADIUS);
      const idx = this.nearest(this.tmp, used);
      used.add(idx);
      return idx;
    });

    items.forEach((item, k) => {
      const index = hubIndex[k];
      const q = this.qubits[index];
      const color = new THREE.Color(item.color);
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
      const glow = glowSprite(toRgba(color), 0.55, 0.6);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), invisible());
      hit.userData = { kind: 'item', itemId: item.id } satisfies HitInfo;
      group.add(ring, ring2, glow, hit);

      const label = makeLabel(item.label, 'hub-label', item.color);
      label.position.copy(q.pos).multiplyScalar(1.2).add(LABEL_DROP); // hacia fuera y un poco por debajo
      this.group.add(group, label);

      // Subsecciones: los cúbits vecinos más cercanos que queden libres.
      const subs = item.items.map((sub) => {
        const idx = this.nearest(q.pos, used);
        used.add(idx);
        const shit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), invisible());
        shit.visible = false;
        shit.userData = { kind: 'sub', itemId: item.id, subId: sub.id } satisfies HitInfo;
        const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
        const sring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.005, 8, 40), ringMat);
        sring.visible = false;
        const slabel = makeLabel(sub.label, 'sub-label', item.color);
        slabel.visible = false;
        const link = makeLink(color);
        const tether = makeLink(color);
        this.group.add(shit, sring, slabel, link, tether);
        return { sub, index: idx, hit: shit, ring: sring, ringMat, label: slabel, link, tether, lifted: this.qubits[idx].pos.clone() };
      });

      this.hubs.push({ item, index, color, group, ringMats, glow, hit, label, scale: 1, active: 0, subs });
    });
  }

  private nearest(target: THREE.Vector3, exclude: Set<number>): number {
    let best = -1;
    let bestD = Infinity;
    this.qubits.forEach((q, i) => {
      if (exclude.has(i)) return;
      const d = q.pos.distanceToSquared(target);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ---------- utilidades ----------

  private bootOf(i: number): number {
    return THREE.MathUtils.smoothstep(this.time * BOOT_RATE - i, 0, 8);
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

const linkDir = new THREE.Vector3();

function makeLink(color: THREE.Color): THREE.Mesh {
  const mesh = new THREE.Mesh(linkGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }));
  mesh.visible = false;
  return mesh;
}

/** Coloca un cilindro unitario entre dos puntos con el grosor indicado. */
function orientLink(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thickness: number): void {
  linkDir.copy(b).sub(a);
  const len = linkDir.length();
  if (len < 1e-5) {
    mesh.visible = false;
    return;
  }
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.scale.set(thickness, len, thickness);
  mesh.quaternion.setFromUnitVectors(UP, linkDir.divideScalar(len));
}

function sameHit(a: HitInfo | null, b: HitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'qubit' && b.kind === 'qubit') return a.index === b.index;
  if (a.kind === 'sub' && b.kind === 'sub') return a.itemId === b.itemId && a.subId === b.subId;
  if (a.kind === 'item' && b.kind === 'item') return a.itemId === b.itemId;
  return false;
}

function toRgba(c: THREE.Color): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},1)`;
}
