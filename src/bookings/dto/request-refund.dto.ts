import { IsString, IsUUID } from 'class-validator';

export class RequestRefundDto {
  @IsString()
  @IsUUID()
  clientPayoutAccountId: string;
}
