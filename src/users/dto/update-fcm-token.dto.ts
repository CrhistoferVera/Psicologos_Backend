import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFcmTokenDto {
    @ApiProperty({ description: 'Token del dispositivo generado por Firebase' })
    @IsString()
    @IsNotEmpty()
    fcmToken: string;
}
