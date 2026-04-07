import { IsInt, Min } from 'class-validator';

export class UpsertSubscriptionDto {
  @IsInt()
  @Min(1)
  price: number;
}
