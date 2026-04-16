import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class CreateFlowPaymentDto {
  @ApiProperty({ description: 'ID del paquete a recargar' })
  @IsString()
  @IsUUID()
  packageId: string;
}
