import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DeliveryFailureReason, DeliveryMethod } from '../../common/enums';

@Index(['orderId'])
@Index(['storeId'])
@Entity({ name: 'deliveries' })
export class DeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'confirmed_by_user_id' })
  confirmedByUserId: string;

  @Column({
    type: 'enum',
    enum: DeliveryMethod,
    enumName: 'DeliveryMethod',
    nullable: true,
  })
  method: DeliveryMethod | null;

  @CreateDateColumn({ name: 'delivered_at', type: 'timestamptz' })
  deliveredAt: Date;

  @Column({
    name: 'failure_reason',
    type: 'enum',
    enum: DeliveryFailureReason,
    enumName: 'DeliveryFailureReason',
    nullable: true,
  })
  failureReason: DeliveryFailureReason | null;

  @Column({ nullable: true, type: 'text' })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
