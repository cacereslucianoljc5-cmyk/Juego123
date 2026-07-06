# ⚔️ Mazmorra NPC — juego estilo Isaac en 3D

Juego de acción por oleadas inspirado en *The Binding of Isaac*, hecho con
**Three.js** (sin build, sitio estático). Los personajes están modelados en 3D
proceduralmente, inspirados en las figuras NPC estilo Clash:

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
- `js/characters.js` — modelos 3D procedurales (héroe, esqueleto, bárbaro, arquero, gigante, cofres…)
- `js/game.js` — bucle del juego: oleadas, IA, combate, jefes, cofres, puntaje
- `lib/three.module.js` — Three.js r160 vendoreado

## Despliegue

Cada push a `main` o a `claude/isaac-style-3d-game-27nx2u` publica el juego en
GitHub Pages mediante [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
