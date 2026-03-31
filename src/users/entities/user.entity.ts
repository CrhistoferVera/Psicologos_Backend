import { User, UserRole, Wallet, UserProfile } from '@prisma/client';
import { Exclude } from 'class-transformer';

export class UserEntity implements User {
  id: string;
  phoneNumber: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isProfileComplete: boolean;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastLogin: Date | null;

  isActive: boolean;

  wallet?: Wallet | null;
  userProfile?: UserProfile | null;

  @Exclude()
  password: string | null;

  @Exclude()
  fcmToken: string | null;

  @Exclude()
  resetPasswordToken: string | null;

  @Exclude()
  resetPasswordExpiry: Date | null;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
