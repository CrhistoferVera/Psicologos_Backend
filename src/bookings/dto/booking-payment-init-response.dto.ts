import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BookingPaymentInitResponseDto {
  @ApiProperty()
  bookingId: string;

  @ApiProperty({ enum: ['BANECO_QR', 'STRIPE'] })
  paymentMethod: 'BANECO_QR' | 'STRIPE';

  @ApiProperty({ enum: ['BOB', 'USD'] })
  currency: 'BOB' | 'USD';

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional()
  qrImage?: string | null;

  @ApiPropertyOptional()
  providerReference?: string | null;

  @ApiPropertyOptional()
  paymentIntentClientSecret?: string | null;

  @ApiPropertyOptional()
  customerId?: string | null;

  @ApiPropertyOptional()
  ephemeralKey?: string | null;

  @ApiPropertyOptional()
  publishableKey?: string | null;

  @ApiPropertyOptional()
  expiresAt?: Date | null;
}
