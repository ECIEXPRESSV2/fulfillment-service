import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo global: expone `PrismaService` a toda la app. Prisma solo vive en
 * la capa `infra/` de cada dominio (CLAUDE.md §4), que inyecta este servicio.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
