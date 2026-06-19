import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiNotFoundResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CodesRepository } from '../../codes/infra/codes.repository';
import { QrService } from '../domain/qr.service';

/**
 * Imagen pública del QR (`GET /fulfillment/qr/:token.png`). Fuera del prefijo `/api/v1` y
 * pública: protegida solo por lo inadivinable del token (CLAUDE.md §6, §7). La usa Notification
 * en correo/WhatsApp. Express 5 no soporta params con sufijo, así que se captura `:file` y se
 * le quita la extensión `.png`.
 */
@ApiTags('QR')
@Controller('fulfillment/qr')
export class QrController {
  constructor(
    private readonly qrService: QrService,
    private readonly codesRepo: CodesRepository,
  ) {}

  @Public()
  @Get(':file')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  @ApiOperation({
    summary: 'Imagen PNG del código QR de retiro',
    description:
      'Devuelve el PNG del QR que codifica el token del código de retiro. Público (protegido ' +
      'por lo inadivinable del token). La ruta termina en `.png` (ej. `/fulfillment/qr/<token>.png`).',
  })
  @ApiParam({
    name: 'file',
    description: 'Token del código seguido de `.png`.',
    example: 'mO9c2Xb7Kd....png',
  })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: 'Imagen PNG del QR.' })
  @ApiNotFoundResponse({ description: 'No existe un código con ese token.' })
  async getQrImage(@Param('file') file: string): Promise<StreamableFile> {
    const token = file.replace(/\.png$/i, '');

    const code = await this.codesRepo.findByToken(token);
    if (!code) {
      throw new NotFoundException({
        code: 'CODE_NOT_FOUND',
        message: 'No encontramos un código de retiro para esta imagen.',
      });
    }

    const png = await this.qrService.generatePng(token);
    return new StreamableFile(png, { type: 'image/png' });
  }
}
