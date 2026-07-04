import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Genera la imagen genérica de "pedido entregado" que se manda por WhatsApp al confirmar la
 * entrega. Es una comprobante visual con el **ID del pedido impreso** (para reclamos), no una
 * foto real: no hay captura del vendedor. Se construye un SVG y se rasteriza a PNG con `sharp`
 * (WhatsApp solo acepta imágenes raster). El texto usa la fuente del sistema del contenedor
 * (ver Dockerfile: fontconfig + ttf-dejavu).
 */
@Injectable()
export class DeliveryImageService {
  /** PNG (1080×1080) con la marca, el check de entregado y el ID del pedido. */
  async generatePng(orderId: string): Promise<Buffer> {
    const safeOrderId = this.escapeXml(orderId);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16a34a"/>
      <stop offset="1" stop-color="#065f46"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <circle cx="540" cy="380" r="150" fill="#ffffff"/>
  <path d="M470 380 l45 48 l95 -100" fill="none" stroke="#16a34a" stroke-width="34"
        stroke-linecap="round" stroke-linejoin="round"/>
  <text x="540" y="630" text-anchor="middle" font-family="sans-serif" font-size="76"
        font-weight="700" fill="#ffffff">¡Pedido entregado!</text>
  <text x="540" y="712" text-anchor="middle" font-family="sans-serif" font-size="40"
        fill="#d1fae5">Gracias por comprar en ECIExpress</text>
  <rect x="140" y="800" width="800" height="150" rx="24" fill="#ffffff" fill-opacity="0.12"/>
  <text x="540" y="858" text-anchor="middle" font-family="sans-serif" font-size="34"
        fill="#d1fae5">Pedido</text>
  <text x="540" y="912" text-anchor="middle" font-family="monospace" font-size="40"
        font-weight="700" fill="#ffffff">${safeOrderId}</text>
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private escapeXml(value: string): string {
    return value.replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case "'":
          return '&apos;';
        default:
          return '&quot;';
      }
    });
  }
}
