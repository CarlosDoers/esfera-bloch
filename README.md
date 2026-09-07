# Bloch · Menú interactivo 3D

Menú a pantalla completa construido sobre una **esfera de Bloch** con Three.js,
pensado para el Centro de Computación Cuántica IBM-Euskadi (Donostia).

La retícula **heavy-hex** real del procesador IBM Quantum Heron —156 cúbits y 176
acopladores— va envuelta sobre la esfera: cada fila de 16 cúbits es un paralelo y los
28 cúbits puente enlazan una banda con la siguiente. Los enlaces son los acopladores
de la máquina y la numeración sigue la de IBM, así que `Q·042` es el cúbit 42 del chip.
Entre la última columna y la primera queda una costura sin acoplador: la retícula del
chip es abierta y aquí se ve tal cual.

Las secciones del menú son cúbits destacados; al pulsar uno, sus cúbits **acoplados**
se despegan de la esfera y se colocan en una corona **por fuera de su silueta**, de
izquierda a derecha en el mismo orden que el panel; la esfera se corre a la izquierda
para dejar sitio al panel. No se dibuja ninguna línea entre la sección y sus
subsecciones ni anillos alrededor de ellas: lo que las agrupa es el color y la cercanía.

El color de un territorio se **reescala** antes de usarlo en la escena 3D
(`balanceGlow`). El bloom recorta por luminancia y el rosa y el morado la tienen mucho
más baja que el cian, el verde o el ámbar —la luminancia la manda el canal verde—, así
que con el mismo umbral florecían la tercera parte. Se sube su intensidad hasta
igualarlos. El color de las etiquetas y del panel no se toca: ahí no interviene el bloom.

La corona se construye alrededor del **eje de la cámara**, no del cúbit de la sección:
`focusOn` solo iguala el azimut, así que una sección por debajo del ecuador queda hasta
25° fuera de eje y su corona se descentraría justo de la silueta que hay que despejar.
El despegue (`SUB_LIFT`) se deduce del ángulo y del aire que se quiere dejar
(`SUB_CLEARANCE`) en vez de fijarse a ojo. En pantallas estrechas no hay sitio para eso:
la corona vuelve a apoyarse sobre la esfera y las etiquetas 3D se ocultan, porque el
panel ya lista las subsecciones a pantalla completa. Mientras hay una sección enfocada, el resto de la escena baja de
intensidad para concentrar la atención. Nada orbita: la esfera gira para encarar la sección
elegida.

Como la esfera esconde la mitad de sus cúbits en la cara oculta, un **raíl** lateral mantiene
las secciones siempre visibles y navegables con teclado; al pulsar una, la esfera gira hasta
ella.

## Entrada

El arranque va por fases, y el gesto que lo lleva es un **anillo de luz que baja del
polo |0⟩ al |1⟩**: como las filas del chip son paralelos, el barrido por latitud
recorre el procesador fila a fila y de paso enseña cómo está envuelto sobre la esfera.

1. **0 – 0,9 s.** Aparece el armazón: cristal, borde, rejilla de meridianos y ecuador.
2. **0,97 – 3,0 s.** El anillo baja encendiendo bandas. Cada cúbit **llega desde fuera de
   la esfera**, destella y se posa con un rebote; los acopladores se dibujan justo
   detrás del anillo. El contador del HUD sube de 0 a 156 al ritmo del barrido.
3. **3,0 s.** Aparecen los estados base |0⟩ y |1⟩ y la esfera se queda quieta. La hélice
   y la flecha ya no entran aquí: son parte de la interacción, no del decorado.

La cámara empieza cerca y casi a la altura del ecuador y se retira durante 3,6 s; el
autogiro espera a que termine. Si pulsas algo mientras tanto, la entrada se da por
terminada y no te hace esperar.

## Paleta

**Un acento y neutros**, en `src/palette.ts` y replicada en los tokens de `style.css`.

Antes había cinco colores puros repartidos por la rueda —40°, 128°, 190°, 255°, 313°,
todos a valor máximo—, uno por sección. Eso es lo que sale cuando se elige un color por
sección en vez de una paleta, y era lo que hacía que todo pareciera un árbol de navidad:
con cinco acentos, ninguno destaca.

Con un solo acento la jerarquía es automática. Las reglas de la casa:

- El acento es **solo para lo seleccionado** y para lo que de verdad está pasando.
- La estructura —retícula, acopladores, líneas— va en el color de línea y **no emite luz**.
- Los marcadores de sección están apagados en reposo; el brillo se lo gana el elegido.
- Mayúsculas espaciadas solo en dos sitios: el logotipo y el antetítulo del panel. Cuando
  todo es un micro-label espaciado no hay jerarquía tipográfica, solo textura.
- Nada de `backdrop-filter`, radios grandes, sombras enormes ni degradados de borde.

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
| Hover sobre un cúbit | Muestra su índice en el chip (Q·042) |
| Hover sobre una sección | La resalta |
| Hover sobre una subsección | La flecha del estado apunta a esa opción |
| Hover sobre el raíl | Resalta su cúbit en la escena, aunque esté en la cara oculta |
| Clic en el raíl | Igual que pulsar la sección; una segunda pulsación cierra |
| Clic en una sección | La esfera gira hacia ella, sus subsecciones se despegan hacia fuera formando una corona y se abre el panel. Todo lo demás baja de intensidad |
| Clic en una subsección o botón del panel | Dispara `app.onNavigate(item, sub)` |
| Clic en la sección abierta | La cierra y vuelven a verse las demás |
| Esc / clic en vacío / × | Cierra el submenú y devuelve la escena a su intensidad original |

## Estructura

```
src/
├─ main.ts            # arranque; aquí conectas onNavigate con tu router
├─ menu.json          # ← contenido del menú: territorios, colores e items
├─ menu.ts            # tipos del menú y QUBIT_COUNT
├─ style.css          # UI HTML, ficha de cúbits y estilos de las etiquetas 3D
├─ ui/Overlay.ts      # raíl de territorios, panel lateral, contador de cúbits y toasts
└─ scene/
   ├─ App.ts          # renderer, cámara (con encaje en vertical), controles, bloom, raycast, eventos, giro de enfoque
   ├─ BlochSphere.ts  # esfera, ecuador, hélice, vector de estado, |0⟩ |1⟩
   ├─ HeavyHex.ts     # topología del Heron: 156 cúbits, 176 acopladores, BFS
   ├─ QubitLattice.ts # la retícula envuelta en la esfera, secciones y subsecciones
   └─ helpers.ts      # geometrías, texturas, etiquetas, fresnel
```

## Contenido del menú

Todo el contenido está en `src/menu.json`. El cliente llama **territorios** a las
entradas principales; cada una lleva sus **items** (subsecciones). No hay color por
territorio: el site usa **un acento y neutros** (`src/palette.ts`) y las secciones se
distinguen por su sitio y su nombre.

```json
{
  "territorios": [
    {
      "id": "grado",
      "label": "Grado",
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
elige el cúbit (nunca uno puente, que solo tiene dos acoplamientos) y coloca las
subsecciones automáticamente. `npm run build` falla si
falta algún campo obligatorio.
