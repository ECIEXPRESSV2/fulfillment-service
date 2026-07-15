import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PickupCodeStatus } from '../../common/enums';

@Index(['orderId'])
@Entity({ name: 'pickup_codes' })
export class PickupCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'buyer_id' })
  buyerId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ unique: true })
  token: string;

  @Column({ name: 'short_code', unique: true })
  shortCode: string;

  @Column({
    type: 'enum',
    enum: PickupCodeStatus,
    enumName: 'PickupCodeStatus',
    default: PickupCodeStatus.ACTIVE,
  })
  status: PickupCodeStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Cuándo se avisó por WhatsApp/SMS que el código está por vencer (5 min antes). */
  @Column({ name: 'expiry_warning_sent_at', type: 'timestamptz', nullable: true })
  expiryWarningSentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
