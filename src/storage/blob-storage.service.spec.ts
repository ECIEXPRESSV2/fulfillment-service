import { ConfigService } from '@nestjs/config';
import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { BlobStorageService } from './blob-storage.service';
import { EnvironmentVariables } from '../config/env.config';

const uploadData = jest.fn().mockResolvedValue(undefined);
const createIfNotExists = jest.fn().mockResolvedValue(undefined);
const getUserDelegationKey = jest.fn().mockResolvedValue({ signedObjectId: 'obj' });

jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('@azure/storage-blob', () => ({
  BlobServiceClient: jest.fn().mockImplementation(() => ({
    getContainerClient: () => ({
      createIfNotExists,
      getBlockBlobClient: () => ({
        uploadData,
        url: 'https://acct.blob.core.windows.net/qr-codes/o1/tok.png',
      }),
    }),
    getUserDelegationKey,
  })),
  BlobSASPermissions: { parse: jest.fn().mockReturnValue('r') },
  generateBlobSASQueryParameters: jest.fn().mockReturnValue({ toString: () => 'sig=abc' }),
  SASProtocol: { Https: 'https' },
}));

function build(account?: string) {
  const config = {
    get: (key: string) => (key === 'AZURE_STORAGE_ACCOUNT' ? account : undefined),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new BlobStorageService(config);
}

describe('BlobStorageService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enabled=false cuando no hay cuenta configurada', () => {
    expect(build(undefined).enabled).toBe(false);
  });

  it('enabled=true cuando hay cuenta', () => {
    expect(build('acct').enabled).toBe(true);
  });

  it('lanza si se intenta subir sin cuenta configurada', async () => {
    await expect(
      build(undefined).uploadWithReadSas({
        container: 'qr-codes',
        blobName: 'o1/tok.png',
        content: Buffer.from('x'),
        contentType: 'image/png',
        ttlMinutes: 60,
      }),
    ).rejects.toThrow(/deshabilitado/i);
  });

  it('sube el blob y devuelve la URL con el SAS anexado', async () => {
    const url = await build('acct').uploadWithReadSas({
      container: 'qr-codes',
      blobName: 'o1/tok.png',
      content: Buffer.from('png'),
      contentType: 'image/png',
      ttlMinutes: 60,
    });
    expect(BlobServiceClient).toHaveBeenCalledWith(
      'https://acct.blob.core.windows.net',
      expect.anything(),
    );
    expect(createIfNotExists).toHaveBeenCalled();
    expect(uploadData).toHaveBeenCalled();
    expect(getUserDelegationKey).toHaveBeenCalled();
    expect(generateBlobSASQueryParameters).toHaveBeenCalled();
    expect(url).toBe('https://acct.blob.core.windows.net/qr-codes/o1/tok.png?sig=abc');
  });

  it('reutiliza la user-delegation key en subidas cercanas', async () => {
    const service = build('acct');
    const input = {
      container: 'qr-codes',
      blobName: 'o1/tok.png',
      content: Buffer.from('png'),
      contentType: 'image/png',
      ttlMinutes: 60,
    };
    await service.uploadWithReadSas(input);
    await service.uploadWithReadSas(input);
    // Segunda subida reutiliza la key cacheada (no vuelve a pedirla).
    expect(getUserDelegationKey).toHaveBeenCalledTimes(1);
  });

  it('dos subidas concurrentes (sin key cacheada aún) piden la delegation key una sola vez', async () => {
    const service = build('acct');
    const input = {
      container: 'qr-codes',
      blobName: 'o1/tok.png',
      content: Buffer.from('png'),
      contentType: 'image/png',
      ttlMinutes: 60,
    };
    // Antes del fix, ambas veían la caché vacía a la vez y cada una llamaba a
    // getUserDelegationKey por su lado.
    await Promise.all([service.uploadWithReadSas(input), service.uploadWithReadSas(input)]);
    expect(getUserDelegationKey).toHaveBeenCalledTimes(1);
  });
});
