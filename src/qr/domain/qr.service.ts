import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

/**
 * Genera la imagen PNG del código QR. El QR codifica el **token opaco** del código de retiro;
 * la validación siempre ocurre server-side (el QR es un bearer token, CLAUDE.md §6).
 */
@Injectable()
export class QrService {
  /** Devuelve el PNG (Buffer) que codifica el token. */
  generatePng(token: string): Promise<Buffer> {
    return QRCode.toBuffer(token, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    });
  }
}
