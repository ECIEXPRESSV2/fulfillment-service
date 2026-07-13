import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserNameToStoreStaff1721000001000 implements MigrationInterface {
  name = 'AddUserNameToStoreStaff1721000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "store_staff" ADD COLUMN IF NOT EXISTS "user_name" text',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "store_staff" DROP COLUMN IF EXISTS "user_name"',
    );
  }
}
