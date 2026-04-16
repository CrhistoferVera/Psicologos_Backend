import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CompleteRegistrationDto {
  @IsString()
  tempToken: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(6)
  confirmPassword: string;

  @IsOptional()
  @IsString()
  referralCode?: string;
}
