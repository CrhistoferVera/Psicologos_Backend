import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Email invalido' })
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'El codigo debe tener 6 digitos' })
  code: string;

  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  newPassword: string;
}

