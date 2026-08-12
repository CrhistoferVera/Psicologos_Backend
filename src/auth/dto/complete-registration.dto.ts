import { IsOptional, IsString, MinLength } from 'class-validator';

export class CompleteRegistrationDto {
  @IsString()
  tempToken: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(6)
  confirmPassword: string;

  @IsString()
  country: string;

  @IsOptional()
  @IsString()
  referralCode?: string;
}
