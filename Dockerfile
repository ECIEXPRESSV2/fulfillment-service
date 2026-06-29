FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g pnpm

# Copia la app COMPLETA del builder (deps incl. dev, dist, src, data-source, tsconfig):
# se necesitan ts-node + la fuente para correr las migraciones (migration:run) al arrancar.
COPY --from=builder /app ./

EXPOSE 3005

# Migraciones al INICIAR: el contenedor corre dentro de la VNet y alcanza el Postgres
# privado (no se pueden correr en build ni desde el pipeline, que no ve la red privada).
# migration:run es idempotente (tabla de migraciones). Luego arranca la app.
CMD ["sh", "-c", "pnpm run migration:run && node dist/main.js"]
