# ⚔️ Mazmorra NPC — juego estilo Isaac en 3D

Juego de acción por oleadas inspirado en *The Binding of Isaac*, hecho con
**Three.js** (sin build, sitio estático). Los enemigos y la arena usan los
modelos GLB del repo [clash3deee](https://github.com/cacereslucianoljc5-cmyk/clash3deee)
(optimizados de ~100 MB a ~3,5 MB con gltf-transform: simplificación de malla,
texturas WebP y cuantización); el héroe es procedural:

| Personaje | Rol |
|---|---|
| 🤍 Héroe blanco con espada | **Jugador** |
| 💀 Esqueleto | Enemigo rápido y frágil |
| 🏹 Arquero de capucha azul | Enemigo a distancia (dispara flechas) |
| 🗡️ Bárbaro de casco amarillo | Enemigo resistente cuerpo a cuerpo |
| 👹 Gigante pelirrojo | **Jefe** (cada 5 oleadas) — suelta cofres |

## Cómo se juega

- **WASD / flechas**: moverse — **Ratón**: apuntar — **Clic / Espacio**: espadazo
- **E**: menú de cofres — **P / Esc**: pausa
- Sobreviví oleadas: cuantas más superás, más puntaje.
- Cada 5 oleadas aparece un **jefe gigante** que al morir suelta un **cofre**
  (de madera, dorado o mágico).
- Los cofres se guardan en tu inventario y se abren desde el **menú de cofres**,
  donde te dan **monedas** 🪙. Monedas, cofres y récord se guardan en el navegador.

## 🎨 Retexturizador 3D con IA

Además del juego, el repo incluye una **herramienta de retexturizado de modelos 3D
por prompt** (estilo Sloyd), en [`retexture.html`](retexture.html):

1. **Cargá** tu propio modelo `.glb` / `.gltf` (arrastrando o con el botón) — o usá
   el modelo de ejemplo que se carga solo.
2. **Escribí un prompt** describiendo el material o estilo
   (`oro viejo con gemas rojas`, `madera de roble`, `escamas de dragón verde`,
   `metal oxidado`, `mármol blanco`, `lava incandescente`, `neón cyberpunk`, …).
3. La app **genera texturas al vuelo** (albedo, mapa de normales, rugosidad y
   emisión) y **repinta el modelo** en un visor PBR con reflejos e iluminación.
4. **Exportás** el resultado como `.glb` con las texturas incrustadas
   (se abre en Blender, Unity o cualquier visor glTF).

Todo corre **100% en el navegador**, sin API keys ni servicios de pago: la "IA"
es un intérprete de lenguaje natural (español/inglés) que mapea palabras clave
—color, material, patrón, acabado, desgaste— a parámetros, más una **síntesis
procedural determinista** (misma frase ⇒ misma textura). El código deja el punto
de extensión listo para enchufar una API real de generación de imágenes si se
quisiera.

- Podés repintar **todo el modelo** o **una malla concreta** con prompts distintos.
- Sliders de ajuste fino: metalicidad, rugosidad, relieve del normal map y escala
  del patrón.

**Motor:** [`js/texture-engine.js`](js/texture-engine.js) (intérprete + síntesis) ·
**App/visor:** [`js/retexture.js`](js/retexture.js) ·
**Add-ons vendoreados:** `GLTFExporter`, `OrbitControls`, `RoomEnvironment`, `TextureUtils`.

## Ejecutar en local

Es un sitio estático con módulos ES, así que solo hace falta un servidor:

```bash
npx serve .          # o: python3 -m http.server 8000
```

y abrir <http://localhost:8000> (o el puerto que indique).

## Estructura

- `index.html` — HUD, menús (inicio, pausa, cofres, fin de juego) y estilos
- `js/characters.js` — carga de modelos GLB (enemigos + arena) y modelos procedurales (héroe, cofres…)
- `js/game.js` — bucle del juego: oleadas, IA, combate, jefes, cofres, puntaje, calidad adaptativa
- `models/*.glb` — Esqueleto, Arquero, Bárbaro, Gigante y Arena (del repo clash3deee, optimizados)
- `lib/` — Three.js r160 + GLTFLoader vendoreados

## Despliegue

Cada push a `main` publica el juego en GitHub Pages (vía la rama `gh-pages`,
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

**Al publicar cambios**: subí el número en `version.json` **y** el
`window.GAME_VERSION` de `index.html` (deben coincidir). La página compara su
versión contra `version.json` (sin caché) y se recarga sola si quedó vieja —
así la caché de 10 minutos de GitHub Pages no muestra código desactualizado.
