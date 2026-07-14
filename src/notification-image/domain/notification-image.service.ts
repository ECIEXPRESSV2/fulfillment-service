import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class NotificationImageService {
  async generateConfirmedPng(orderId: string): Promise<Buffer> {
    const safe = this.esc(orderId);
    return this.render(safe, {
      bg: ['#0f3460', '#1a5276'],
      circleFill: '#ffffff',
      path: 'M470 380 l45 48 l95 -100',
      pathStroke: '#0f3460',
      title: '¡Pedido confirmado!',
      titleFill: '#ffffff',
      subtitle: 'Te notificaremos cuando el código de retiro esté listo',
      subtitleFill: '#a0c4ff',
    });
  }

  async generateCancelledPng(orderId: string): Promise<Buffer> {
    const safe = this.esc(orderId);
    return this.render(safe, {
      bg: ['#6b7280', '#4b5563'],
      circleFill: '#ffffff',
      path: 'M440 320 l200 200 M640 320 l-200 200',
      pathStroke: '#6b7280',
      title: 'Pedido cancelado',
      titleFill: '#ffffff',
      subtitle: 'Si pagaste, el saldo será reintegrado a tu billetera',
      subtitleFill: '#d1d5db',
    });
  }

  async generateQrExpiredPng(orderId: string): Promise<Buffer> {
    const safe = this.esc(orderId);
    return this.render(safe, {
      bg: ['#b34141', '#8b2020'],
      circleFill: '#ffffff',
      path: 'M540 320 v80 M540 440 v60',
      pathStroke: '#b34141',
      title: 'Código de entrega vencido',
      titleFill: '#ffffff',
      subtitle: 'Producto no reclamado',
      subtitleFill: '#f5b7b7',
      extraText: 'Si crees que hay un error, comunícate con la tienda',
    });
  }

  async generatePaymentProcessedPng(orderId: string, amount: string): Promise<Buffer> {
    const safe = this.esc(orderId);
    const safeAmount = this.esc(amount);
    return this.render(safe, {
      bg: ['#16a34a', '#065f46'],
      circleFill: '#ffffff',
      path: 'M470 380 l45 48 l95 -100',
      pathStroke: '#16a34a',
      title: '¡Pago exitoso!',
      titleFill: '#ffffff',
      subtitle: `Se procesó el pago de tu pedido`,
      subtitleFill: '#d1fae5',
      amount: safeAmount,
    });
  }

  async generateRefundIssuedPng(orderId: string, amount: string): Promise<Buffer> {
    const safe = this.esc(orderId);
    const safeAmount = this.esc(amount);
    return this.render(safe, {
      bg: ['#1e40af', '#3b82f6'],
      circleFill: '#ffffff',
      path: 'M380 400 l60-60 l60 60 M380 400 l60 60 l60-60 M460 340 v120',
      pathStroke: '#1e40af',
      title: 'Reembolso procesado',
      titleFill: '#ffffff',
      subtitle: `El valor fue reintegrado a tu billetera`,
      subtitleFill: '#bfdbfe',
      amount: safeAmount,
    });
  }

  private render(
    orderId: string,
    opts: {
      bg: [string, string];
      circleFill: string;
      path: string;
      pathStroke: string;
      title: string;
      titleFill: string;
      subtitle: string;
      subtitleFill: string;
      extraText?: string;
      amount?: string;
    },
  ): Promise<Buffer> {
    const amountSection = opts.amount
      ? `
    <rect x="140" y="740" width="800" height="80" rx="16" fill="#ffffff" fill-opacity="0.12"/>
    <text x="540" y="794" text-anchor="middle" font-family="sans-serif" font-size="42" font-weight="700" fill="#ffffff">${opts.amount}</text>`
      : '';

    const extraSection = opts.extraText
      ? `
    <text x="540" y="780" text-anchor="middle" font-family="sans-serif" font-size="28" fill="${opts.subtitleFill}">${opts.extraText}</text>`
      : '';

    const boxY = opts.amount ? '860' : opts.extraText ? '820' : '780';

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${opts.bg[0]}"/>
      <stop offset="1" stop-color="${opts.bg[1]}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <circle cx="540" cy="360" r="140" fill="${opts.circleFill}"/>
  <path d="${opts.path}" fill="none" stroke="${opts.pathStroke}" stroke-width="32"
        stroke-linecap="round" stroke-linejoin="round"/>
  <text x="540" y="610" text-anchor="middle" font-family="sans-serif" font-size="64"
        font-weight="700" fill="${opts.titleFill}">${opts.title}</text>
  <text x="540" y="682" text-anchor="middle" font-family="sans-serif" font-size="32"
        fill="${opts.subtitleFill}">${opts.subtitle}</text>${amountSection}${extraSection}
  <rect x="140" y="${boxY}" width="800" height="130" rx="20" fill="#ffffff" fill-opacity="0.10"/>
  <text x="540" y="${+boxY + 45}" text-anchor="middle" font-family="sans-serif" font-size="28"
        fill="${opts.subtitleFill}">Pedido</text>
  <text x="540" y="${+boxY + 95}" text-anchor="middle" font-family="monospace" font-size="36"
        font-weight="700" fill="#ffffff">${orderId}</text>
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private esc(v: string): string {
    return v.replace(/[<>&'"]/g, (c) => {
      switch (c) { case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;'; case "'": return '&apos;'; default: return '&quot;'; }
    });
  }
}
