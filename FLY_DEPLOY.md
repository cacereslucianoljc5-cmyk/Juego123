# Despliegue en Fly.io

Este repositorio está configurado para desplegarse automáticamente en
[Fly.io](https://fly.io) mediante GitHub Actions.

## Cómo funciona

- **`Dockerfile`** — sirve los archivos estáticos del repo con nginx en el
  puerto `8080` (sin paso de build).
- **`nginx.conf`** — configuración de nginx para servir el sitio.
- **`fly.toml`** — configuración de la app en Fly (región, puerto interno,
  auto-stop/start de máquinas para ahorrar).
- **`.github/workflows/fly-deploy.yml`** — despliega en cada `push` a la rama
  por defecto usando `flyctl deploy`.

## Puesta en marcha (una sola vez)

Necesitas la CLI de Fly instalada localmente y una cuenta en Fly.io.

```bash
# 1. Instalar flyctl
curl -L https://fly.io/install.sh | sh

# 2. Iniciar sesión
fly auth login

# 3. Crear la app en Fly (usa el nombre de fly.toml o elige otro)
#    Si cambias el nombre, actualízalo también en fly.toml.
fly apps create juego123

# 4. Crear un token de despliegue para GitHub Actions
fly tokens create deploy -x 999999h
```

Copia el token que devuelve el último comando y guárdalo como **secret** del
repositorio en GitHub:

- Ve a **Settings → Secrets and variables → Actions → New repository secret**
- Nombre: `FLY_API_TOKEN`
- Valor: el token generado

## Desplegar

A partir de ahí, cada push a la rama por defecto dispara el workflow y publica
la nueva versión. También puedes lanzarlo manualmente desde la pestaña
**Actions → Deploy to Fly.io → Run workflow**, o desde tu máquina con:

```bash
fly deploy
```

La URL pública será `https://juego123.fly.dev` (según el nombre de la app).
