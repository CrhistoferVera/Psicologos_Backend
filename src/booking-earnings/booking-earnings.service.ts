import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { PROFESSIONAL_ROLES } from '../common/professional-role';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ReferralsService } from '../referrals/referrals.service';

type CreditBookingEarningPayload = {
  bookingId: string;
  bookingPaymentId?: string;
  source: string;
  requestId?: string;
};

@Injectable()
export class BookingEarningsService {
  private readonly logger = new Logger(BookingEarningsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
    private readonly referralsService: ReferralsService,
  ) {}

  private newReqId() {
    return Math.random().toString(36).slice(2, 9);
  }

  private money(value: Prisma.Decimal | number | string | null | undefined) {
    return new Prisma.Decimal(value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private normalizePercent(value: number) {
    const parsed = new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (parsed.lessThan(0) || parsed.greaterThan(100)) {
      throw new BadRequestException('platformFeePercent debe estar entre 0 y 100.');
    }
    return parsed;
  }

  async creditProfessionalEarningForBooking(payload: CreditBookingEarningPayload) {
    const reqId = payload.requestId ?? this.newReqId();
    const runtimeConfig = await this.systemConfigService.getRuntimeConfig();
    const platformCommissionPercent = this.normalizePercent(runtimeConfig.platformFeePercent);
    const hundred = new Prisma.Decimal(100);

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const booking = await tx.booking.findUnique({
            where: { id: payload.bookingId },
            select: {
              id: true,
              clientId: true,
              professionalId: true,
              sessionOfferingId: true,
              status: true,
              paymentStatus: true,
              currency: true,
              priceBob: true,
              priceUsd: true,
              scheduledStartAt: true,
              sessionOffering: {
                select: {
                  title: true,
                },
              },
            },
          });

          if (!booking) {
            return { credited: false, reason: 'BOOKING_NOT_FOUND' as const };
          }

          if (
            booking.status !== BookingStatus.CONFIRMED ||
            booking.paymentStatus !== BookingPaymentStatus.PAID
          ) {
            return { credited: false, reason: 'BOOKING_NOT_PAID_CONFIRMED' as const };
          }

          const bookingPayment = payload.bookingPaymentId
            ? await tx.bookingPayment.findFirst({
                where: {
                  id: payload.bookingPaymentId,
                  bookingId: booking.id,
                },
              })
            : await tx.bookingPayment.findFirst({
                where: {
                  bookingId: booking.id,
                  status: BookingPaymentStatus.PAID,
                },
                orderBy: { updatedAt: 'desc' },
              });

          if (!bookingPayment || bookingPayment.status !== BookingPaymentStatus.PAID) {
            return { credited: false, reason: 'BOOKING_PAYMENT_NOT_FOUND' as const };
          }

          const existing = await tx.bookingEarning.findFirst({
            where: {
              OR: [{ bookingId: booking.id }, { bookingPaymentId: bookingPayment.id }],
            },
            select: { id: true },
          });

          if (existing) {
            return {
              credited: false,
              reason: 'ALREADY_CREDITED' as const,
              bookingEarningId: existing.id,
            };
          }

          // grossAmount = precio COMPLETO de la sesión, siempre.
          // bookingPayment.amountBob/Usd puede ser solo el monto externo (QR/Stripe)
          // cuando el cliente pagó parcialmente con wallet. Las comisiones y referidos
          // se calculan sobre el precio total de la sesión.
          const grossAmount =
            booking.currency === 'USD'
              ? this.money(booking.priceUsd)
              : this.money(booking.priceBob);

          if (grossAmount.lessThanOrEqualTo(0)) {
            return { credited: false, reason: 'INVALID_GROSS_AMOUNT' as const };
          }

          // Caso 1 (pro→pro): el 5% del referente sale del monto del profesional
          const proReferral = await this.referralsService.getReferralForProfessional(tx, booking.professionalId);
          const isProToPro = proReferral?.referrerRole && proReferral?.referredRole
            && PROFESSIONAL_ROLES.includes(proReferral.referrerRole)
            && PROFESSIONAL_ROLES.includes(proReferral.referredRole);

          const rewardPercent = new Prisma.Decimal(runtimeConfig.referralRewardPercent);
          const platformCommissionAmount = grossAmount
            .mul(platformCommissionPercent)
            .div(hundred)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

          let professionalAmount = grossAmount
            .minus(platformCommissionAmount)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

          if (isProToPro) {
            // Descontamos el 5% del monto del profesional para el referente
            const referrerCut = grossAmount
              .mul(rewardPercent)
              .div(hundred)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
            professionalAmount = professionalAmount.minus(referrerCut).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
          }

          if (professionalAmount.lessThan(0)) {
            throw new BadRequestException(
              `Monto neto profesional invalido para booking ${booking.id}.`,
            );
          }

          const professionalWallet = await tx.wallet.upsert({
            where: { userId: booking.professionalId },
            create: {
              userId: booking.professionalId,
              balance: new Prisma.Decimal(0),
              promotionalBalance: new Prisma.Decimal(0),
              balanceUsd: new Prisma.Decimal(0),
            },
            update: {},
          });

          const createdEarning = await tx.bookingEarning.create({
            data: {
              bookingId: booking.id,
              bookingPaymentId: bookingPayment.id,
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              walletId: professionalWallet.id,
              currency: booking.currency,
              grossAmount,
              platformCommissionPercent,
              platformCommissionAmount,
              professionalAmount,
              paymentMethod: bookingPayment.method as BookingPaymentMethod,
              status: 'CREDITED',
            },
          });

          if (booking.currency === 'USD') {
            await tx.wallet.update({
              where: { id: professionalWallet.id },
              data: { balanceUsd: { increment: professionalAmount } },
            });
          } else {
            await tx.wallet.update({
              where: { id: professionalWallet.id },
              data: { balance: { increment: professionalAmount } },
            });
          }

          const earningTransaction = await tx.transaction.create({
            data: {
              walletId: professionalWallet.id,
              type: TransactionType.EARNING,
              amount: professionalAmount,
              promotionalAmount: new Prisma.Decimal(0),
              realAmount: professionalAmount,
              isPromotional: false,
              description: JSON.stringify({
                event: 'BOOKING_EARNING_CREDITED',
                source: payload.source,
                bookingId: booking.id,
                bookingPaymentId: bookingPayment.id,
                clientId: booking.clientId,
                professionalId: booking.professionalId,
                sessionOfferingId: booking.sessionOfferingId,
                sessionTitle: booking.sessionOffering?.title ?? null,
                startsAt: booking.scheduledStartAt.toISOString(),
                currency: booking.currency,
                grossAmount: Number(grossAmount),
                platformCommissionPercent: Number(platformCommissionPercent),
                platformCommissionAmount: Number(platformCommissionAmount),
                professionalAmount: Number(professionalAmount),
                paymentMethod: bookingPayment.method,
              }),
            },
          });

          await tx.bookingEarning.update({
            where: { id: createdEarning.id },
            data: { transactionId: earningTransaction.id },
          });

          return {
            credited: true,
            bookingId: booking.id,
            bookingPaymentId: bookingPayment.id,
            bookingEarningId: createdEarning.id,
            clientId: booking.clientId,
            professionalId: booking.professionalId,
            currency: booking.currency,
            grossAmount: Number(grossAmount),
            professionalAmount: Number(professionalAmount),
            platformCommissionAmount: Number(platformCommissionAmount),
            platformCommissionPercent: Number(platformCommissionPercent),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (result.credited) {
        this.logger.log(
          `[BOOKING-EARNING][${reqId}] credited bookingId=${result.bookingId} bookingPaymentId=${result.bookingPaymentId} gross=${result.grossAmount} net=${result.professionalAmount} currency=${result.currency}`,
        );

        if (result.bookingEarningId) {
          try {
            await this.prisma.$transaction(
              async (tx) => this.referralsService.maybeRewardReferrerFromSession(tx, {
                bookingId: result.bookingId as string,
                bookingEarningId: result.bookingEarningId as string,
                clientId: result.clientId as string,
                professionalId: result.professionalId as string,
                grossAmount: new Prisma.Decimal(result.grossAmount as number),
                currency: result.currency as string,
                rewardPercent: runtimeConfig.referralRewardPercent,
                usdExchangeRate: runtimeConfig.usdExchangeRate,
              }),
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
          } catch (err: any) {
            this.logger.error(
              `[BOOKING-EARNING][${reqId}] referral_reward_failed bookingId=${result.bookingId} bookingEarningId=${result.bookingEarningId} err=${err?.message}`,
            );
          }
        }
      } else {
        this.logger.log(
          `[BOOKING-EARNING][${reqId}] skipped bookingId=${payload.bookingId} reason=${result.reason}`,
        );
      }

      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.bookingEarning.findFirst({
          where: payload.bookingPaymentId
            ? {
                OR: [
                  { bookingId: payload.bookingId },
                  { bookingPaymentId: payload.bookingPaymentId },
                ],
              }
            : { bookingId: payload.bookingId },
          select: { id: true },
        });

        this.logger.log(
          `[BOOKING-EARNING][${reqId}] already_credited bookingId=${payload.bookingId} reason=UNIQUE_CONSTRAINT`,
        );
        return {
          credited: false,
          reason: 'ALREADY_CREDITED' as const,
          bookingEarningId: existing?.id ?? null,
        };
      }

      throw error;
    }
  }
}
