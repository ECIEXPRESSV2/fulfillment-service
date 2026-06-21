import { Module } from '@nestjs/common';
import { CodesModule } from '../codes/codes.module';
import { QrService } from './domain/qr.service';
import { QrController } from './http/qr.controller';

/**
 * Imagen del QR. Importa `CodesModule` para verificar que el token exista antes de generar
 * el PNG (no servir imágenes de tokens inexistentes).
 */
@Module({
  imports: [CodesModule],
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}
