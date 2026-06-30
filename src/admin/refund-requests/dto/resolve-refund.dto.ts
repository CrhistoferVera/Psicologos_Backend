import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export enum ResolveRefundAction {
  PAID = 'PAID',
  REJECTED = 'REJECTED',
}

export class ResolveRefundDto {
  @IsEnum(ResolveRefundAction)
  action: ResolveRefundAction;

  @ValidateIf((o) => o.action === ResolveRefundAction.REJECTED)
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
