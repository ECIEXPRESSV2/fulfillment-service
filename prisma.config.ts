import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 requiere este archivo de configuración. `migrate dev` ya no corre
// `seed`/`generate` automáticamente: se ejecutan explícitamente (ver CLAUDE.md §3 y §16).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
