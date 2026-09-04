# Bloch · Menú interactivo 3D

Menú a pantalla completa construido sobre una **esfera de Bloch** con Three.js,
pensado para el Centro de Computación Cuántica IBM-Euskadi (Donostia).

Los **156 cúbits** del procesador IBM Quantum Heron se reparten sobre la superficie
de la esfera, enlazados con sus vecinos como un mapa de acoplamiento. Las secciones
del menú son cúbits destacados; al pulsar uno, sus cúbits vecinos se despegan de la
esfera hacia fuera, unidos a la sección por un enlace, y muestran las subsecciones; además
se abre un panel lateral. Mientras hay una sección enfocada, el resto de la escena baja de
intensidad para concentrar la atención. Nada orbita: la esfera gira para encarar la sección
elegida.

## Stack

- [Vite](https://vite.dev) + TypeScript
- [Three.js](https://threejs.org) (WebGL, postprocesado con bloom, etiquetas CSS2D)

## Uso

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # compila en dist/
npm run preview  # sirve dist/
```

## Interacción

| Acción | Resultado |
| --- | --- |
| Arrastrar | Orbita la cámara alrededor de la esfera |
| Rueda / pellizco | Zoom |
| Hover sobre un cúbit | Muestra su índice (Q·042) |
| Hover sobre una sección | La resalta |
| Clic en una sección | La esfera gira hacia ella, sus subsecciones se despegan hacia fuera y se abre el panel. Todo lo demás baja de intensidad |
| Clic en una subsección o botón del panel | Dispara `app.onNavigate(item, sub)` |
| Esc / clic en vacío / × | Cierra el submenú y devuelve la escena a su intensidad original |

## Estructura

```
src/
├─ main.ts            # arranque; aquí conectas onNavigate con tu router
├─ menu.json          # ← contenido del menú: territorios, colores e items
├─ menu.ts            # tipos del menú y QUBIT_COUNT
├─ style.css          # UI HTML, ficha de cúbits y estilos de las etiquetas 3D
├─ ui/Overlay.ts      # panel lateral, contador de cúbits y toasts
└─ scene/
   ├─ App.ts          # renderer, cámara, controles, bloom, raycast, eventos, giro de enfoque
   ├─ BlochSphere.ts  # esfera punteada, ecuador, hélice, vector de estado, |0⟩ |1⟩
   ├─ QubitLattice.ts # 156 cúbits, enlaces, secciones y subsecciones despegables
   ├─ Floor.ts        # suelo espejo + rejilla
   ├─ Starfield.ts    # estrellas
   └─ helpers.ts      # geometrías, texturas, etiquetas, fresnel
```

## Contenido del menú

Todo el contenido está en `src/menu.json`. El cliente llama **territorios** a las
entradas principales; cada una lleva sus **items** (subsecciones):

```json
{
  "territorios": [
    {
      "id": "grado",
      "label": "Grado",
      "color": "#4fe3ff",
      "description": "Formación académica de excelencia con enfoque cuántico…",
      "items": [
        { "id": "plan-de-estudios", "label": "Plan de estudios", "description": "8 semestres · 42 asignaturas · 320 créditos" }
      ]
    }
  ]
}
```

| Campo | Obligatorio | Uso |
| --- | --- | --- |
| `id` | sí | Identificador que recibe `onNavigate`; sin espacios ni acentos |
| `label` | sí | Texto visible en la esfera y en el panel |
| `color` | sí (territorio) | Color del cúbit, de sus items y del acento del panel |
| `description` | sí (territorio) / opcional (item) | Texto del panel lateral |
| `items` | sí (territorio) | Subsecciones; puede ir vacío |

Para añadir un territorio o un item basta con añadir una entrada al JSON: la esfera
elige el cúbit y coloca las subsecciones automáticamente. `npm run build` falla si
falta algún campo obligatorio.
