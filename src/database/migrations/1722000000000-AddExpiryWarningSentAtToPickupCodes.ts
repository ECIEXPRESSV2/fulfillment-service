import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * pickup_codes.expiry_warning_sent_at: marca cuándo se avisó por WhatsApp/SMS que un código
 * está por vencer (5 minutos antes). Evita reenviar el aviso en cada tick del cron mientras
 * el código sigue dentro de la ventana de aviso.
 */
export class AddExpiryWarningSentAtToPickupCodes1722000000000 implements MigrationInterface {
  name = 'AddExpiryWarningSentAtToPickupCodes1722000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "pickup_codes" ADD COLUMN IF NOT EXISTS "expiry_warning_sent_at" timestamptz',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "pickup_codes" DROP COLUMN IF EXISTS "expiry_warning_sent_at"',
    );
  }
}
