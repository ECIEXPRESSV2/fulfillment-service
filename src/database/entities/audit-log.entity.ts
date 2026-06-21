import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditAction } from '../../common/enums';

@Index(['orderId'])
@Entity({ name: 'audit_logs' })
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', nullable: true, type: 'text' })
  actorId: string | null;

  @Column({
    type: 'enum',
    enum: AuditAction,
    enumName: 'AuditAction',
  })
  action: AuditAction;

  @Column({ name: 'order_id', nullable: true, type: 'text' })
  orderId: string | null;

  @Column({ name: 'pickup_code_id', nullable: true, type: 'text' })
  pickupCodeId: string | null;

  @Column({ name: 'delivery_id', nullable: true, type: 'text' })
  deliveryId: string | null;

  @Column({ nullable: true, type: 'text' })
  reason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'correlation_id', nullable: true, type: 'text' })
  correlationId: string | null;

  @Column({ name: 'ip_address', nullable: true, type: 'text' })
  ipAddress: string | null;

  @Column({ name: 'user_agent', nullable: true, type: 'text' })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
