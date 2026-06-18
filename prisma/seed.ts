import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Seed idempotente. Por ahora el MVP no necesita datos base obligatorios:
 * las proyecciones (`order_projection`, `store_staff`) se alimentan por eventos.
 * Se deja el esqueleto para sembrar datos de prueba locales sin romper nada si
 * se corre varias veces.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Espacio para upserts idempotentes de datos de prueba (cuando se requieran).
    console.log('Seed completado (sin datos base requeridos en el MVP).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Error ejecutando el seed:', error);
  process.exit(1);
});
