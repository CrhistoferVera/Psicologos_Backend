import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateSessionOfferingStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}
