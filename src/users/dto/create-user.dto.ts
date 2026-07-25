import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  phoneDialCode?: string;

  @IsOptional()
  @IsString()
  phoneNationalNumber?: string;

  @IsOptional()
  @IsString()
  phoneCountryIso?: string;

  @IsOptional()
  @IsString()
  phoneCountryName?: string;

  @IsOptional()
  @IsString()
  billingRegion?: string;

  @IsOptional()
  @IsString()
  preferredCurrency?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsBoolean()
  @IsOptional()
  isProfileComplete?: boolean;
}
