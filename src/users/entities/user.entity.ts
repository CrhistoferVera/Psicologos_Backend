import { User, KycStatus, Country, UserRole } from '@prisma/client';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UserEntity implements User {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  // ✅ CORRECTO: Excluimos el password
  @Exclude()
  password: string | null;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ required: false, nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ enum: Country })
  country: Country;

  @ApiProperty({ required: false, nullable: true })
  walletAddress: string | null;

  @ApiProperty({ enum: KycStatus })
  kycStatus: KycStatus;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ required: false, nullable: true })
  lastLogin: Date | null;

  @Exclude()
  resetPasswordToken: string | null;

  @Exclude()
  resetPasswordExpiry: Date | null;

  @ApiProperty({ nullable: true })
  isGoogleAccount: boolean;

  @ApiProperty()
  isOnboardingCompleted: boolean;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  isFirstMint: boolean;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
  kycSessionId: string | null;
  kycSessionExpiresAt: Date | null;
  kycSimilarity: number | null;
  kycLivenessScore: number | null;
}