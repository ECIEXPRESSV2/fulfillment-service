import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SERVICE_NAME = 'fulfillment-service';
const LOCK_FILE = path.join(os.tmpdir(), `${SERVICE_NAME}-swagger.lock`);
const HOT_RELOAD_WINDOW_MS = 10_000;

function isBrowserRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /nh', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      return /chrome\.exe|msedge\.exe|firefox\.exe|brave\.exe|opera\.exe/i.test(out);
    }
    const out = execSync('ps aux', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /Google Chrome|Safari|firefox|Brave Browser|Chromium/i.test(out);
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { windowsHide: true });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function openSwaggerIfBrowserOpen(url: string): void {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const { timestamp } = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as {
        timestamp: number;
      };
      if (Date.now() - timestamp < HOT_RELOAD_WINDOW_MS) {
        return;
      }
    } catch {
      // lock file corrupted or old format — proceed
    }
  }

  if (!isBrowserRunning()) return;

  fs.writeFileSync(LOCK_FILE, JSON.stringify({ timestamp: Date.now() }), 'utf-8');
  openBrowser(url);
}

function cleanupLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

process.on('SIGTERM', () => {
  cleanupLock();
  process.exit(0);
});

process.on('SIGINT', () => {
  cleanupLock();
  process.exit(0);
});

async function bootstrap() {
  // `cors: true` permite que el frontend (otro origen, ej. Vite en :5173) llame al servicio.
  // Igual que orders-service; en producción el API Gateway controla el origen real.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, cors: true });

  // Logger estructurado (Pino) para toda la app.
  app.useLogger(app.get(Logger));

  // Prefijo global /api/v1; `/` y `/health` quedan fuera (CLAUDE.md §7).
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
      // Imagen pública del QR: vive en /fulfillment/qr/:file, fuera de /api/v1 (CLAUDE.md §7).
      { path: 'fulfillment/qr/:file', method: RequestMethod.GET },
    ],
  });

  // Validación global de DTOs (class-validator/class-transformer).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Fulfillment Service — ECIxpress')
    .setDescription(
      'Microservicio de logística y entrega: genera y valida códigos de retiro (QR), ' +
        'confirma entregas y publica los eventos que disparan pago (Financial) y ' +
        'notificaciones (Notification).\n\n' +
        'Autenticación: Fulfillment confía en los headers que inyecta el API Gateway. ' +
        'Usa el header `x-user-id` (y `x-user-role` / `x-user-store`) para simular peticiones.',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-user-id' },
      'x-user-id',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-user-role' },
      'x-user-role',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-user-store' },
      'x-user-store',
    )
    .addTag('Sistema', 'Raíz y healthcheck del servicio.')
    .addTag('Códigos de retiro', 'Generación, consulta, validación y confirmación de códigos.')
    .addTag('Entregas', 'Confirmación, entrega manual, fallida e historial por tienda.')
    .addTag('QR', 'Imagen pública del código QR de retiro.')
    .addTag('Estado de fulfillment', 'Estado del proceso de retiro por pedido.')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  openSwaggerIfBrowserOpen(`http://localhost:${port}/api`);
}
bootstrap();
