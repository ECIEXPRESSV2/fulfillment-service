import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Raíz del servicio',
    description: 'Endpoint público de bienvenida. No requiere autenticación.',
  })
  @ApiOkResponse({ description: 'Mensaje de bienvenida del servicio.' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Healthcheck',
    description: 'Estado del servicio para readiness/liveness probes. Público.',
  })
  @ApiOkResponse({
    description: 'El servicio está operativo.',
    schema: {
      example: {
        status: 'ok',
        service: 'fulfillment-service',
        timestamp: '2026-06-18T15:00:00.000Z',
      },
    },
  })
  getHealth(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'fulfillment-service',
      timestamp: new Date().toISOString(),
    };
  }
}
