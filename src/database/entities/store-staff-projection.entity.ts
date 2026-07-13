import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { StoreStaffRole } from '../../common/enums';

@Index(['storeId'])
@Unique(['storeId', 'userId'])
@Entity({ name: 'store_staff' })
export class StoreStaffProjectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'user_name', type: 'text', nullable: true })
  userName: string | null;

  @Column({
    type: 'enum',
    enum: StoreStaffRole,
    enumName: 'StoreStaffRole',
  })
  role: StoreStaffRole;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
