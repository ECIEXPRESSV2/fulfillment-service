import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1719792000000 implements MigrationInterface {
  name = 'InitSchema1719792000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enums (IF NOT EXISTS guards — Neon DB already has these from Prisma)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "PickupCodeStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'INVALIDATED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "DeliveryMethod" AS ENUM ('QR', 'MANUAL');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "DeliveryFailureReason" AS ENUM ('CUSTOMER_NO_SHOW', 'SELLER_REJECTED', 'ORDER_NOT_AVAILABLE', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "StoreStaffRole" AS ENUM ('OWNER', 'STAFF');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "AuditAction" AS ENUM (
          'CODE_GENERATED', 'CODE_VALIDATED', 'DELIVERY_CONFIRMED',
          'MANUAL_DELIVERY', 'DELIVERY_FAILED', 'CODE_INVALIDATED', 'CODE_EXPIRED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Tables
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pickup_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        short_code TEXT NOT NULL UNIQUE,
        status "PickupCodeStatus" NOT NULL DEFAULT 'ACTIVE',
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pickup_codes_order_id ON pickup_codes (order_id);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_code_per_order
        ON pickup_codes (order_id)
        WHERE status = 'ACTIVE';
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        confirmed_by_user_id TEXT NOT NULL,
        method "DeliveryMethod",
        delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        failure_reason "DeliveryFailureReason",
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_order_id ON deliveries (order_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_store_id ON deliveries (store_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS order_projection (
        order_id TEXT PRIMARY KEY,
        buyer_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        pickup_expires_at TIMESTAMPTZ,
        status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS store_staff (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role "StoreStaffRole" NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_store_staff_store_user UNIQUE (store_id, user_id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_store_staff_store_id ON store_staff (store_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        routing_key TEXT NOT NULL,
        event_version INT NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        status "OutboxStatus" NOT NULL DEFAULT 'PENDING',
        retry_count INT NOT NULL DEFAULT 0,
        last_error TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        next_retry_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_outbox_events_status_retry ON outbox_events (status, next_retry_at);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS processed_events (
        idempotency_key TEXT PRIMARY KEY,
        routing_key TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id TEXT,
        action "AuditAction" NOT NULL,
        order_id TEXT,
        pickup_code_id TEXT,
        delivery_id TEXT,
        reason TEXT,
        metadata JSONB,
        correlation_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_order_id ON audit_logs (order_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS processed_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox_events;`);
    await queryRunner.query(`DROP TABLE IF EXISTS store_staff;`);
    await queryRunner.query(`DROP TABLE IF EXISTS order_projection;`);
    await queryRunner.query(`DROP TABLE IF EXISTS deliveries;`);
    await queryRunner.query(`DROP TABLE IF EXISTS pickup_codes;`);
    await queryRunner.query(`DROP TYPE IF EXISTS "AuditAction";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "StoreStaffRole";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "OutboxStatus";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "DeliveryFailureReason";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "DeliveryMethod";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "PickupCodeStatus";`);
  }
}
