import { IsString, IsNotEmpty, IsOptional, IsEmail, MinLength, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteAnfitrioneRegistrationDto {
    @ApiProperty({ description: 'Token temporal obtenido al verificar OTP' })
    @IsString()
    @IsNotEmpty()
    tempToken: string;

    @ApiProperty({ example: 'Camila' })
    @IsString()
    @IsNotEmpty()
    firstName: string;

    @ApiProperty({ example: 'Sanches' })
    @IsString()
    @IsNotEmpty()
    lastName: string;

    @ApiProperty({ example: 'camila@gmail.com', required: false })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiProperty({ minLength: 6 })
    @IsString()
    @MinLength(6)
    password: string;

    @ApiProperty({ minLength: 6 })
    @IsString()
    @MinLength(6)
    confirmPassword: string;

    @ApiProperty({ example: 'camila_princ' })
    @IsString()
    @IsNotEmpty()
    username: string;

    @ApiProperty({ example: '1995-06-15' })
    @IsDateString()
    @IsNotEmpty()
    dateOfBirth: string;

    @ApiProperty({ example: '12345678' })
    @IsString()
    @IsNotEmpty()
    cedula: string;

    @ApiProperty({ example: 'SALUDAB12', required: false })
    @IsOptional()
    @IsString()
    referralCode?: string;
}
