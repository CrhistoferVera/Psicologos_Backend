import { User, UserRole, Wallet, UserProfile } from '@prisma/client';
import { Exclude } from 'class-transformer';

export class UserEntity implements User {
  id: string;
  phoneNumber: string | null;
  phoneDialCode: string | null;
  phoneNationalNumber: string | null;
  phoneCountryIso: string | null;
  phoneCountryName: string | null;
  country: string | null;
  billingRegion: string | null;
  preferredCurrency: string | null;
  email: string | null;
  referralCode: string | null;
  firstName: string | null;
  lastName: string | null;
  isProfileComplete: boolean;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastLogin: Date | null;

  isActive: boolean;
  stripeCustomerId: string | null;

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

