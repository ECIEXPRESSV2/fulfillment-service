import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameColumnsToSnakeCase1719792001000 implements MigrationInterface {
  name = 'RenameColumnsToSnakeCase1719792001000';

  private async renameIfExists(
    queryRunner: QueryRunner,
    table: string,
    from: string,
    to: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = '${table}' AND column_name = '${from}'
        ) THEN
          ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}";
        END IF;
      END $$;
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pickup_codes
    await this.renameIfExists(queryRunner, 'pickup_codes', 'orderId', 'order_id');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'buyerId', 'buyer_id');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'storeId', 'store_id');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'shortCode', 'short_code');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'expiresAt', 'expires_at');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'usedAt', 'used_at');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'createdAt', 'created_at');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'updatedAt', 'updated_at');

    // deliveries
    await this.renameIfExists(queryRunner, 'deliveries', 'orderId', 'order_id');
    await this.renameIfExists(queryRunner, 'deliveries', 'storeId', 'store_id');
    await this.renameIfExists(queryRunner, 'deliveries', 'confirmedByUserId', 'confirmed_by_user_id');
    await this.renameIfExists(queryRunner, 'deliveries', 'deliveredAt', 'delivered_at');
    await this.renameIfExists(queryRunner, 'deliveries', 'failureReason', 'failure_reason');
    await this.renameIfExists(queryRunner, 'deliveries', 'createdAt', 'created_at');

    // order_projection
    await this.renameIfExists(queryRunner, 'order_projection', 'orderId', 'order_id');
    await this.renameIfExists(queryRunner, 'order_projection', 'buyerId', 'buyer_id');
    await this.renameIfExists(queryRunner, 'order_projection', 'storeId', 'store_id');
    await this.renameIfExists(queryRunner, 'order_projection', 'pickupExpiresAt', 'pickup_expires_at');
    await this.renameIfExists(queryRunner, 'order_projection', 'createdAt', 'created_at');
    await this.renameIfExists(queryRunner, 'order_projection', 'updatedAt', 'updated_at');

    // store_staff
    await this.renameIfExists(queryRunner, 'store_staff', 'storeId', 'store_id');
    await this.renameIfExists(queryRunner, 'store_staff', 'userId', 'user_id');
    await this.renameIfExists(queryRunner, 'store_staff', 'isActive', 'is_active');
    await this.renameIfExists(queryRunner, 'store_staff', 'createdAt', 'created_at');
    await this.renameIfExists(queryRunner, 'store_staff', 'updatedAt', 'updated_at');

    // outbox_events
    await this.renameIfExists(queryRunner, 'outbox_events', 'aggregateId', 'aggregate_id');
    await this.renameIfExists(queryRunner, 'outbox_events', 'aggregateType', 'aggregate_type');
    await this.renameIfExists(queryRunner, 'outbox_events', 'eventType', 'event_type');
    await this.renameIfExists(queryRunner, 'outbox_events', 'routingKey', 'routing_key');
    await this.renameIfExists(queryRunner, 'outbox_events', 'eventVersion', 'event_version');
    await this.renameIfExists(queryRunner, 'outbox_events', 'retryCount', 'retry_count');
    await this.renameIfExists(queryRunner, 'outbox_events', 'lastError', 'last_error');
    await this.renameIfExists(queryRunner, 'outbox_events', 'idempotencyKey', 'idempotency_key');
    await this.renameIfExists(queryRunner, 'outbox_events', 'nextRetryAt', 'next_retry_at');
    await this.renameIfExists(queryRunner, 'outbox_events', 'createdAt', 'created_at');
    await this.renameIfExists(queryRunner, 'outbox_events', 'publishedAt', 'published_at');

    // processed_events
    await this.renameIfExists(queryRunner, 'processed_events', 'idempotencyKey', 'idempotency_key');
    await this.renameIfExists(queryRunner, 'processed_events', 'routingKey', 'routing_key');
    await this.renameIfExists(queryRunner, 'processed_events', 'processedAt', 'processed_at');

    // audit_logs
    await this.renameIfExists(queryRunner, 'audit_logs', 'actorId', 'actor_id');
    await this.renameIfExists(queryRunner, 'audit_logs', 'orderId', 'order_id');
    await this.renameIfExists(queryRunner, 'audit_logs', 'pickupCodeId', 'pickup_code_id');
    await this.renameIfExists(queryRunner, 'audit_logs', 'deliveryId', 'delivery_id');
    await this.renameIfExists(queryRunner, 'audit_logs', 'correlationId', 'correlation_id');
    await this.renameIfExists(queryRunner, 'audit_logs', 'ipAddress', 'ip_address');
    await this.renameIfExists(queryRunner, 'audit_logs', 'userAgent', 'user_agent');
    await this.renameIfExists(queryRunner, 'audit_logs', 'createdAt', 'created_at');

    // Create indexes that were skipped in InitSchema because columns were camelCase
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_pickup_codes_order_id ON pickup_codes (order_id);`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_code_per_order
        ON pickup_codes (order_id)
        WHERE status = 'ACTIVE';
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_order_id ON deliveries (order_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_store_id ON deliveries (store_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_store_staff_store_id ON store_staff (store_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_outbox_events_status_retry ON outbox_events (status, next_retry_at);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_order_id ON audit_logs (order_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // pickup_codes
    await this.renameIfExists(queryRunner, 'pickup_codes', 'order_id', 'orderId');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'buyer_id', 'buyerId');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'store_id', 'storeId');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'short_code', 'shortCode');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'expires_at', 'expiresAt');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'used_at', 'usedAt');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'created_at', 'createdAt');
    await this.renameIfExists(queryRunner, 'pickup_codes', 'updated_at', 'updatedAt');

    // deliveries
    await this.renameIfExists(queryRunner, 'deliveries', 'order_id', 'orderId');
    await this.renameIfExists(queryRunner, 'deliveries', 'store_id', 'storeId');
    await this.renameIfExists(queryRunner, 'deliveries', 'confirmed_by_user_id', 'confirmedByUserId');
    await this.renameIfExists(queryRunner, 'deliveries', 'delivered_at', 'deliveredAt');
    await this.renameIfExists(queryRunner, 'deliveries', 'failure_reason', 'failureReason');
    await this.renameIfExists(queryRunner, 'deliveries', 'created_at', 'createdAt');

    // order_projection
    await this.renameIfExists(queryRunner, 'order_projection', 'order_id', 'orderId');
    await this.renameIfExists(queryRunner, 'order_projection', 'buyer_id', 'buyerId');
    await this.renameIfExists(queryRunner, 'order_projection', 'store_id', 'storeId');
    await this.renameIfExists(queryRunner, 'order_projection', 'pickup_expires_at', 'pickupExpiresAt');
    await this.renameIfExists(queryRunner, 'order_projection', 'created_at', 'createdAt');
    await this.renameIfExists(queryRunner, 'order_projection', 'updated_at', 'updatedAt');

    // store_staff
    await this.renameIfExists(queryRunner, 'store_staff', 'store_id', 'storeId');
    await this.renameIfExists(queryRunner, 'store_staff', 'user_id', 'userId');
    await this.renameIfExists(queryRunner, 'store_staff', 'is_active', 'isActive');
    await this.renameIfExists(queryRunner, 'store_staff', 'created_at', 'createdAt');
    await this.renameIfExists(queryRunner, 'store_staff', 'updated_at', 'updatedAt');

    // outbox_events
    await this.renameIfExists(queryRunner, 'outbox_events', 'aggregate_id', 'aggregateId');
    await this.renameIfExists(queryRunner, 'outbox_events', 'aggregate_type', 'aggregateType');
    await this.renameIfExists(queryRunner, 'outbox_events', 'event_type', 'eventType');
    await this.renameIfExists(queryRunner, 'outbox_events', 'routing_key', 'routingKey');
    await this.renameIfExists(queryRunner, 'outbox_events', 'event_version', 'eventVersion');
    await this.renameIfExists(queryRunner, 'outbox_events', 'retry_count', 'retryCount');
    await this.renameIfExists(queryRunner, 'outbox_events', 'last_error', 'lastError');
    await this.renameIfExists(queryRunner, 'outbox_events', 'idempotency_key', 'idempotencyKey');
    await this.renameIfExists(queryRunner, 'outbox_events', 'next_retry_at', 'nextRetryAt');
    await this.renameIfExists(queryRunner, 'outbox_events', 'created_at', 'createdAt');
    await this.renameIfExists(queryRunner, 'outbox_events', 'published_at', 'publishedAt');

    // processed_events
    await this.renameIfExists(queryRunner, 'processed_events', 'idempotency_key', 'idempotencyKey');
    await this.renameIfExists(queryRunner, 'processed_events', 'routing_key', 'routingKey');
    await this.renameIfExists(queryRunner, 'processed_events', 'processed_at', 'processedAt');

    // audit_logs
    await this.renameIfExists(queryRunner, 'audit_logs', 'actor_id', 'actorId');
    await this.renameIfExists(queryRunner, 'audit_logs', 'order_id', 'orderId');
    await this.renameIfExists(queryRunner, 'audit_logs', 'pickup_code_id', 'pickupCodeId');
    await this.renameIfExists(queryRunner, 'audit_logs', 'delivery_id', 'deliveryId');
    await this.renameIfExists(queryRunner, 'audit_logs', 'correlation_id', 'correlationId');
    await this.renameIfExists(queryRunner, 'audit_logs', 'ip_address', 'ipAddress');
    await this.renameIfExists(queryRunner, 'audit_logs', 'user_agent', 'userAgent');
    await this.renameIfExists(queryRunner, 'audit_logs', 'created_at', 'createdAt');
  }
}
