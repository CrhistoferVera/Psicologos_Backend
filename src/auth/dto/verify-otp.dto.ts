import { IsOptional, IsString } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  phoneDialCode: string;

  @IsString()
  phoneNationalNumber: string;

  @IsString()
  phoneCountryIso: string;

  @IsString()
  phoneCountryName: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsString()
  code: string;
}
