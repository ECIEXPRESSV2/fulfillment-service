import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'order_projection' })
export class OrderProjectionEntity {
  @PrimaryColumn({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'order_number', type: 'text', nullable: true })
  orderNumber: string | null;

  @Column({ name: 'buyer_id' })
  buyerId: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'pickup_expires_at', type: 'timestamptz', nullable: true })
  pickupExpiresAt: Date | null;

  @Column({ nullable: true, type: 'text' })
  status: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
