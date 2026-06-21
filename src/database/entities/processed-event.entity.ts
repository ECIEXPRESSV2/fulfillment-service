import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'processed_events' })
export class ProcessedEventEntity {
  @PrimaryColumn({ name: 'idempotency_key' })
  idempotencyKey: string;

  @Column({ name: 'routing_key' })
  routingKey: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
