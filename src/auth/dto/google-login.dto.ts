import { IsOptional, IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  @MinLength(10)
  idToken: string;

  // Pais elegido en el registro; solo se usa al crear una cuenta nueva
  // para derivar billingRegion / preferredCurrency (Bolivia vs internacional).
  @IsOptional()
  @IsString()
  country?: string;
}
