import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderNumberToProjection1721000000000 implements MigrationInterface {
  name = 'AddOrderNumberToProjection1721000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "order_projection" ADD COLUMN IF NOT EXISTS "order_number" text',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "order_projection" DROP COLUMN IF EXISTS "order_number"',
    );
  }
}
