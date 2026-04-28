import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Rojas' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'ana@correo.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+59170000000' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'ana_rojas' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userName?: string;

  @ApiPropertyOptional({ example: 'Me interesa la salud mental y el bienestar.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;
}