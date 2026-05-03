import { IsString, IsOptional } from 'class-validator';

export class SendOtpDto {
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
}
