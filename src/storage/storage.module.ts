import { Module } from '@nestjs/common';
import { BlobStorageService } from './blob-storage.service';

/**
 * Acceso a Azure Blob Storage (subida de imágenes + user-delegation SAS). Se importa donde se
 * necesite persistir imágenes accesibles por terceros (p. ej. el QR que WhatsApp descarga).
 */
@Module({
  providers: [BlobStorageService],
  exports: [BlobStorageService],
})
export class StorageModule {}
