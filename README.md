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

Cada push a `main` o a `claude/isaac-style-3d-game-27nx2u` publica el juego en
GitHub Pages mediante [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
