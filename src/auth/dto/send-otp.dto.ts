import { IsString } from 'class-validator';

export class SendOtpDto {
  @IsString()
  phoneNumber: string;
}
