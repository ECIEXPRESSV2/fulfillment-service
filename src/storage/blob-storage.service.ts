import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  UserDelegationKey,
} from '@azure/storage-blob';
import { EnvironmentVariables } from '../config/env.config';

/** Parámetros para subir un blob y obtener su URL firmada. */
export interface UploadWithSasInput {
  container: string;
  blobName: string;
  content: Buffer;
  contentType: string;
  /** Vida del SAS de lectura en minutos. */
  ttlMinutes: number;
}

/**
 * Acceso a Azure Blob Storage con Managed Identity (`DefaultAzureCredential`, igual que el bus).
 * Sube imágenes a un contenedor **privado** y devuelve una **user-delegation SAS URL** de solo
 * lectura y expiración corta: nunca se expone la account key ni se hace público el contenedor.
 *
 * Requiere que la identidad tenga el rol **Storage Blob Data Contributor** sobre la cuenta.
 * Si `AZURE_STORAGE_ACCOUNT` no está configurada, `enabled` es `false` y el llamador cae al
 * endpoint público de fallback (útil en local/dev sin credenciales de Azure).
 */
@Injectable()
export class BlobStorageService {
  private readonly logger = new Logger(BlobStorageService.name);
  private readonly account?: string;
  private client?: BlobServiceClient;
  /** Cache de la user-delegation key para no pedirla en cada subida (se renueva al vencer). */
  private delegationKey?: { key: UserDelegationKey; expiresOn: Date };
  // Sin este lock, dos generaciones de QR casi simultáneas ven la caché vacía a la vez y
  // cada una dispara su propio getUserDelegationKey() contra Azure en paralelo — la misma
  // carrera que causaba el invalid_grant de Gmail, aquí terminaba en el fallback a
  // localhost. Con el lock, las llamadas concurrentes esperan la MISMA promesa.
  private keyFetchInFlight: Promise<UserDelegationKey> | null = null;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    this.account = config.get('AZURE_STORAGE_ACCOUNT', { infer: true }) || undefined;
  }

  /** `true` si hay cuenta configurada y por tanto se puede subir a blob. */
  get enabled(): boolean {
    return Boolean(this.account);
  }

  private getClient(): BlobServiceClient {
    if (!this.client) {
      this.client = new BlobServiceClient(
        `https://${this.account}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );
    }
    return this.client;
  }

  /**
   * Sube (o sobrescribe) un blob y devuelve su URL con SAS de lectura. Idempotente respecto al
   * nombre: reintentos del mismo evento suben el mismo contenido al mismo blob sin duplicar.
   */
  async uploadWithReadSas(input: UploadWithSasInput): Promise<string> {
    if (!this.enabled) {
      throw new Error('BlobStorageService deshabilitado: falta AZURE_STORAGE_ACCOUNT');
    }
    const service = this.getClient();
    const blob = service
      .getContainerClient(input.container)
      .getBlockBlobClient(input.blobName);

    await blob.uploadData(input.content, {
      blobHTTPHeaders: { blobContentType: input.contentType },
    });

    // 5 min de holgura hacia atrás para tolerar desfases de reloj entre el cliente y Azure.
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + input.ttlMinutes * 60 * 1000);
    const key = await this.getDelegationKey(startsOn, expiresOn);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: input.container,
        blobName: input.blobName,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      key,
      this.account!,
    ).toString();

    return `${blob.url}?${sas}`;
  }

  /**
   * Reutiliza la user-delegation key mientras cubra la ventana pedida; si no, la renueva.
   * Si ya hay un fetch en curso (disparado por otra subida concurrente), espera ESE mismo
   * en vez de pedir una key nueva por su lado.
   */
  private async getDelegationKey(
    startsOn: Date,
    expiresOn: Date,
  ): Promise<UserDelegationKey> {
    const cached = this.delegationKey;
    if (cached && cached.expiresOn > expiresOn) {
      return cached.key;
    }
    if (!this.keyFetchInFlight) {
      // Se pide con un margen extra para amortizar la cache entre subidas cercanas.
      const keyExpiry = new Date(expiresOn.getTime() + 60 * 60 * 1000);
      this.keyFetchInFlight = this.getClient()
        .getUserDelegationKey(startsOn, keyExpiry)
        .then((key) => {
          this.delegationKey = { key, expiresOn: keyExpiry };
          return key;
        })
        .finally(() => {
          this.keyFetchInFlight = null;
        });
    }
    return this.keyFetchInFlight;
  }
}
