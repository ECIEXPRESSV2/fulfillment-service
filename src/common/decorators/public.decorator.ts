import { SetMetadata } from '@nestjs/common';

/** Clave de metadata que marca una ruta como pública (sin `GatewayAuthGuard`). */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como público: omite la autenticación por headers del gateway.
 * Usado en `GET /`, `GET /health` y la imagen pública del QR.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
