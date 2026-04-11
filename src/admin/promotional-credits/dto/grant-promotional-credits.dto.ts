import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';

export class GrantPromotionalCreditsDto {
  @IsUUID()
  userId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason?: string;
}
