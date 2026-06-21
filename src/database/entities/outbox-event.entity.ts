import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OutboxStatus } from '../../common/enums';

@Index(['status', 'nextRetryAt'])
@Entity({ name: 'outbox_events' })
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'aggregate_id' })
  aggregateId: string;

  @Column({ name: 'aggregate_type' })
  aggregateType: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'routing_key' })
  routingKey: string;

  @Column({ name: 'event_version', default: 1 })
  eventVersion: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: OutboxStatus,
    enumName: 'OutboxStatus',
    default: OutboxStatus.PENDING,
  })
  status: OutboxStatus;

  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ name: 'last_error', nullable: true, type: 'text' })
  lastError: string | null;

  @Column({ name: 'idempotency_key', unique: true })
  idempotencyKey: string;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
