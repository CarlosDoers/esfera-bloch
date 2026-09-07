import type { Territory, SubItem } from '../menu';

/** Controla la capa HTML: raíl de territorios, panel lateral de submenú y toasts. */
export class Overlay {
  onClose: () => void = () => {};
  onSubClick: (item: Territory, sub: SubItem) => void = () => {};
  /** Pulsación en el raíl. `null` cuando se vuelve a pulsar el territorio activo. */
  onRailClick: (item: Territory | null) => void = () => {};
  /** Puntero sobre el raíl: sirve para resaltar el cúbit en la escena 3D. */
  onRailHover: (item: Territory | null) => void = () => {};

  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly desc: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly qubitCount: HTMLElement;
  private readonly railButtons = new Map<string, HTMLButtonElement>();
  private activeId: string | null = null;
  private toastTimer = 0;

  constructor(root: HTMLElement, items: Territory[]) {
    this.panel = root.querySelector('#panel')!;
    this.title = root.querySelector('.panel-title')!;
    this.desc = root.querySelector('.panel-desc')!;
    this.list = root.querySelector('.panel-list')!;
    this.toastEl = root.querySelector('#toast')!;
    this.qubitCount = root.querySelector('#qubit-count')!;

    root.querySelector('.panel-close')!.addEventListener('click', () => this.onClose());
    this.buildRail(root.querySelector('#rail')!, items);
  }

  /**
   * Raíl siempre visible con todos los territorios: la esfera esconde la mitad de
   * los cúbits en su cara oculta, así que el menú completo vive también en 2D.
   */
  private buildRail(rail: HTMLElement, items: Territory[]): void {
    rail.replaceChildren(
      ...items.map((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rail-item';
        btn.textContent = item.label;
        btn.addEventListener('click', () => this.onRailClick(this.activeId === item.id ? null : item));
        btn.addEventListener('pointerenter', () => this.onRailHover(item));
        btn.addEventListener('pointerleave', () => this.onRailHover(null));
        btn.addEventListener('focus', () => this.onRailHover(item));
        btn.addEventListener('blur', () => this.onRailHover(null));
        this.railButtons.set(item.id, btn);
        return btn;
      }),
    );
  }

  private setActive(id: string | null): void {
    this.activeId = id;
    for (const [key, btn] of this.railButtons) {
      const on = key === id;
      btn.classList.toggle('active', on);
      btn.toggleAttribute('aria-current', on);
    }
  }

  showItem(item: Territory): void {
    this.setActive(item.id);
    this.title.textContent = item.label;
    this.desc.textContent = item.description;

    this.list.replaceChildren(
      ...item.items.map((sub) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML =
          `<span>${sub.label}</span>` + (sub.description ? `<small>${sub.description}</small>` : '');
        btn.addEventListener('click', () => this.onSubClick(item, sub));
        li.appendChild(btn);
        return li;
      }),
    );

    this.panel.classList.add('open');
    this.panel.setAttribute('aria-hidden', 'false');
  }

  setQubitCount(n: number): void {
    this.qubitCount.textContent = String(n);
  }

  hide(): void {
    this.setActive(null);
    this.panel.classList.remove('open');
    this.panel.setAttribute('aria-hidden', 'true');
  }

  toast(html: string, ms = 2200): void {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
