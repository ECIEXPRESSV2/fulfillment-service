FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./

# pnpm 11 bloquea los build scripts de dependencias sin aprobación explícita y hace fallar el
# install (ERR_PNPM_IGNORED_BUILDS). La aprobación vive en pnpm-workspace.yaml, que NO se versiona
# (gitignored: su presencia marcaba entorno dev en Render). Se genera aquí, dentro de la imagen,
# para que `pnpm install` (y el verify-deps de `pnpm run` al arrancar) no fallen. sharp usa su
# binario prebuilt; los demás son postinstalls inocuos.
RUN printf 'allowBuilds:\n  "@nestjs/core": true\n  "@scarf/scarf": true\n  esbuild: true\n  sharp: true\n  unrs-resolver: true\n' > pnpm-workspace.yaml

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Fuentes para que sharp (libvips) renderice el texto de la imagen de entrega en Alpine.
# Sin ellas el SVG se rasteriza sin las letras del ID del pedido.
RUN apk add --no-cache fontconfig ttf-dejavu && fc-cache -f

RUN npm install -g pnpm

# Copia la app COMPLETA del builder (deps incl. dev, dist, src, data-source, tsconfig):
# se necesitan ts-node + la fuente para correr las migraciones (migration:run) al arrancar.
COPY --from=builder /app ./

EXPOSE 3005

# Migraciones al INICIAR: el contenedor corre dentro de la VNet y alcanza el Postgres
# privado (no se pueden correr en build ni desde el pipeline, que no ve la red privada).
# migration:run es idempotente (tabla de migraciones). Luego arranca la app.
CMD ["sh", "-c", "pnpm run migration:run && node dist/main.js"]
