import { IsEmail, IsString, Length } from 'class-validator';

export class VerifySignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;
}