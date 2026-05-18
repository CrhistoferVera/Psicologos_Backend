import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReferralClientBenefitStatus,
  ReferralProfessionalBenefitStatus,
  ReferralStatus,
  TransactionType,
  UserRole,
} from '@prisma/client';
import { PROFESSIONAL_ROLES } from '../common/professional-role';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AdminReferralsQueryDto } from './dto/admin-referrals-query.dto';
import { createUniqueReferralCode } from './utils/referral-code.util';

const VALID_REFERRAL_STATUSES: ReferralStatus[] = [
  ReferralStatus.ACTIVE,
  ReferralStatus.QUALIFIED,
  ReferralStatus.REWARDED,
];

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeNonNegativeInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.trunc(parsed));
  }

  private normalizePositiveInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.trunc(parsed));
  }

  private normalizePercent(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < 0) return 0;
    if (parsed > 100) return 100;
    return parsed;
  }

  private money(value: Prisma.Decimal | number | string | null | undefined) {
    return new Prisma.Decimal(value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private async getReferralRuleConfig() {
    const config = await this.systemConfigService.getRuntimeConfig();
    return {
      validPurchasesRequired: this.normalizeNonNegativeInt(config.referralValidPurchasesRequired, 1),
      threshold: this.normalizePositiveInt(config.referralThreshold, 10),
      clientDiscountPercent: this.normalizePercent(config.referralClientDiscountPercent, 5),
      clientDiscountSessions: this.normalizePositiveInt(config.referralClientDiscountSessions, 10),
      professionalRewardPercent: this.normalizePercent(config.referralProfessionalRewardPercent, 5),
      referralEnabled: Boolean(config.referralEnabled),
    };
  }

  private isValidReferralStatus(status: ReferralStatus) {
    return VALID_REFERRAL_STATUSES.includes(status);
  }

  private async countApprovedWalletTopUps(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    return tx.depositRequest.count({
      where: {
        userId,
        status: 'APPROVED',
        amount: { gt: new Prisma.Decimal(0) },
      },
    });
  }

  private async countPaidBookingSessions(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    return tx.booking.count({
      where: {
        clientId: userId,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        payments: {
          some: {
            status: 'PAID',
          },
        },
      },
    });
  }

  private async countPaidLegacySessions(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    return tx.sessionPayment.count({
      where: {
        clientUserId: userId,
        status: 'APPROVED',
      },
    });
  }

  private async countValidReferralPurchases(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{
    total: number;
    validTopups: number;
    validPaidSessions: number;
  }> {
    const [validTopups, validBookingSessions, validLegacySessions] = await Promise.all([
      this.countApprovedWalletTopUps(tx, userId),
      this.countPaidBookingSessions(tx, userId),
      this.countPaidLegacySessions(tx, userId),
    ]);

    const validPaidSessions = validBookingSessions + validLegacySessions;

    return {
      total: validTopups + validPaidSessions,
      validTopups,
      validPaidSessions,
    };
  }

  async ensureUserReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, referralCode: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');
    if (user.referralCode) return user.referralCode;

    const generated = await createUniqueReferralCode(this.prisma, user.firstName ?? user.id.slice(0, 6));
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode: generated },
      select: { referralCode: true },
    });

    return updated.referralCode as string;
  }

  async resolveReferrerByCode(rawCode: string) {
    const code = this.normalizeCode(rawCode);

    const referrer = await this.prisma.user.findFirst({
      where: {
        referralCode: code,
        isActive: true,
        role: { not: UserRole.ADMIN },
      },
      select: { id: true, firstName: true, lastName: true, referralCode: true },
    });

    if (!referrer) throw new BadRequestException('Codigo de referido invalido.');
    return referrer;
  }

  async createReferralLink(referredUserId: string, rawCode: string) {
    const referrer = await this.resolveReferrerByCode(rawCode);

    if (referrer.id === referredUserId) {
      throw new BadRequestException('No puedes usar tu propio codigo de referido.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.referral.findUnique({
        where: { referredUserId },
        select: { id: true, codeUsed: true, status: true },
      });

      if (existing) {
        if (existing.codeUsed !== referrer.referralCode) {
          throw new BadRequestException('Este usuario ya tiene un referido asociado.');
        }

        await this.refreshReferralQualificationForUser(tx, referredUserId);
        return tx.referral.findUnique({
          where: { referredUserId },
          select: { id: true, codeUsed: true, status: true },
        });
      }

      const created = await tx.referral.create({
        data: {
          referrerUserId: referrer.id,
          referredUserId,
          codeUsed: referrer.referralCode as string,
          status: ReferralStatus.PENDING,
          validPurchasesCount: 0,
        },
        select: { id: true, codeUsed: true, status: true },
      });

      await this.refreshReferralQualificationForUser(tx, referredUserId);

      return tx.referral.findUnique({
        where: { id: created.id },
        select: { id: true, codeUsed: true, status: true },
      });
    });
  }

  private async evaluateReferralBenefitsForReferrer(
    tx: Prisma.TransactionClient,
    referrerUserId: string,
  ) {
    const [referrer, rules] = await Promise.all([
      tx.user.findUnique({
        where: { id: referrerUserId },
        select: { id: true, role: true },
      }),
      this.getReferralRuleConfig(),
    ]);

    if (!referrer || !rules.referralEnabled || rules.threshold <= 0) return;
    if (referrer.role === UserRole.ADMIN) return;

    const validReferrals = await tx.referral.findMany({
      where: {
        referrerUserId,
        status: { in: VALID_REFERRAL_STATUSES },
      },
      orderBy: [{ qualifiedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        referredUserId: true,
      },
    });

    const cyclesEarned = Math.floor(validReferrals.length / rules.threshold);
    if (cyclesEarned <= 0) return;

    if (referrer.role === UserRole.USER) {
      const existingCycles = await tx.referralClientBenefit.count({ where: { referrerUserId } });
      for (let cycle = existingCycles + 1; cycle <= cyclesEarned; cycle += 1) {
        await tx.referralClientBenefit.create({
          data: {
            referrerUserId,
            cycleNumber: cycle,
            threshold: rules.threshold,
            discountPercent: this.money(rules.clientDiscountPercent),
            totalSessions: rules.clientDiscountSessions,
            remainingSessions: rules.clientDiscountSessions,
            status: ReferralClientBenefitStatus.ACTIVE,
            activatedAt: new Date(),
          },
        });
      }
      return;
    }

    if (!PROFESSIONAL_ROLES.includes(referrer.role)) {
      return;
    }

    const existingCampaigns = await tx.referralProfessionalBenefitCampaign.count({
      where: { professionalReferrerId: referrerUserId },
    });

    for (let cycle = existingCampaigns + 1; cycle <= cyclesEarned; cycle += 1) {
      const campaign = await tx.referralProfessionalBenefitCampaign.create({
        data: {
          professionalReferrerId: referrerUserId,
          cycleNumber: cycle,
          threshold: rules.threshold,
          rewardPercent: this.money(rules.professionalRewardPercent),
          status: ReferralProfessionalBenefitStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });

      const from = (cycle - 1) * rules.threshold;
      const to = cycle * rules.threshold;
      const targetReferrals = validReferrals.slice(from, to);

      if (targetReferrals.length === 0) continue;

      await tx.referralProfessionalBeneficiary.createMany({
        data: targetReferrals.map((ref) => ({
          campaignId: campaign.id,
          professionalReferrerId: referrerUserId,
          referredUserId: ref.referredUserId,
          referralId: ref.id,
          rewardPercent: this.money(rules.professionalRewardPercent),
          isActive: true,
          activatedAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }
  }

  async refreshReferralQualificationForUser(
    tx: Prisma.TransactionClient,
    referredUserId: string,
  ) {
    const referral = await tx.referral.findUnique({
      where: { referredUserId },
      select: {
        id: true,
        referrerUserId: true,
        status: true,
        validPurchasesCount: true,
      },
    });

    if (!referral) return null;

    const rules = await this.getReferralRuleConfig();

    const purchaseCounts = rules.validPurchasesRequired > 0
      ? await this.countValidReferralPurchases(tx, referredUserId)
      : { total: 0, validTopups: 0, validPaidSessions: 0 };

    const purchases = purchaseCounts.total;

    const nextValidPurchasesCount = Math.max(referral.validPurchasesCount ?? 0, purchases);
    const shouldBeQualified = rules.validPurchasesRequired === 0 || purchases >= rules.validPurchasesRequired;

    const data: Prisma.ReferralUpdateInput = {};

    if (nextValidPurchasesCount !== referral.validPurchasesCount) {
      data.validPurchasesCount = nextValidPurchasesCount;
    }

    if (shouldBeQualified && !this.isValidReferralStatus(referral.status)) {
      data.status = ReferralStatus.QUALIFIED;
      data.qualifiedAt = new Date();
    }

    if (Object.keys(data).length > 0) {
      await tx.referral.update({
        where: { id: referral.id },
        data,
      });
    }

    if (shouldBeQualified) {
      await this.evaluateReferralBenefitsForReferrer(tx, referral.referrerUserId);
    }

    return tx.referral.findUnique({ where: { id: referral.id } });
  }

  async refreshReferralQualificationFromPaidBooking(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      bookingPaymentId?: string | null;
    },
  ) {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      select: {
        id: true,
        clientId: true,
        status: true,
        paymentStatus: true,
      },
    });

    if (!booking || booking.status !== 'CONFIRMED' || booking.paymentStatus !== 'PAID') {
      return null;
    }

    const bookingPayment = params.bookingPaymentId
      ? await tx.bookingPayment.findFirst({
          where: {
            id: params.bookingPaymentId,
            bookingId: booking.id,
            status: 'PAID',
          },
          select: { id: true },
        })
      : await tx.bookingPayment.findFirst({
          where: {
            bookingId: booking.id,
            status: 'PAID',
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });

    if (!bookingPayment) return null;

    return this.refreshReferralQualificationForUser(tx, booking.clientId);
  }

  async refreshReferralQualificationFromPaidBookingDetached(params: {
    bookingId: string;
    bookingPaymentId?: string | null;
  }) {
    return this.prisma.$transaction(
      async (tx) =>
        this.refreshReferralQualificationFromPaidBooking(tx, {
          bookingId: params.bookingId,
          bookingPaymentId: params.bookingPaymentId,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async handleApprovedDepositForReferral(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    return this.refreshReferralQualificationForUser(tx, userId);
  }

  async resolveClientBookingDiscount(
    tx: Prisma.TransactionClient,
    clientUserId: string,
    basePriceBob: Prisma.Decimal,
    basePriceUsd: Prisma.Decimal,
  ) {
    const activeBenefit = await tx.referralClientBenefit.findFirst({
      where: {
        referrerUserId: clientUserId,
        status: ReferralClientBenefitStatus.ACTIVE,
        remainingSessions: { gt: 0 },
      },
      orderBy: [{ createdAt: 'asc' }, { cycleNumber: 'asc' }],
      select: {
        id: true,
        discountPercent: true,
      },
    });

    const originalBob = this.money(basePriceBob);
    const originalUsd = this.money(basePriceUsd);

    if (!activeBenefit) {
      return {
        priceBob: originalBob,
        priceUsd: originalUsd,
        originalPriceBob: originalBob,
        originalPriceUsd: originalUsd,
        referralDiscountPercent: this.money(0),
        referralDiscountAmountBob: this.money(0),
        referralDiscountAmountUsd: this.money(0),
        referralClientBenefitId: null as string | null,
      };
    }

    const discountPercentNumber = this.normalizePercent(Number(activeBenefit.discountPercent), 0);
    if (discountPercentNumber <= 0) {
      return {
        priceBob: originalBob,
        priceUsd: originalUsd,
        originalPriceBob: originalBob,
        originalPriceUsd: originalUsd,
        referralDiscountPercent: this.money(0),
        referralDiscountAmountBob: this.money(0),
        referralDiscountAmountUsd: this.money(0),
        referralClientBenefitId: null as string | null,
      };
    }

    const discountPercent = this.money(discountPercentNumber);
    const hundred = this.money(100);

    const discountBob = originalBob
      .mul(discountPercent)
      .div(hundred)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const discountUsd = originalUsd
      .mul(discountPercent)
      .div(hundred)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const finalBob = Prisma.Decimal.max(this.money(0), originalBob.minus(discountBob));
    const finalUsd = Prisma.Decimal.max(this.money(0), originalUsd.minus(discountUsd));

    return {
      priceBob: finalBob,
      priceUsd: finalUsd,
      originalPriceBob: originalBob,
      originalPriceUsd: originalUsd,
      referralDiscountPercent: discountPercent,
      referralDiscountAmountBob: discountBob,
      referralDiscountAmountUsd: discountUsd,
      referralClientBenefitId: activeBenefit.id,
    };
  }

  async consumeClientDiscountForPaidBooking(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      bookingPaymentId?: string | null;
    },
  ) {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      select: {
        id: true,
        currency: true,
        paymentStatus: true,
        referralClientBenefitId: true,
        referralDiscountPercent: true,
        referralDiscountAmountBob: true,
        referralDiscountAmountUsd: true,
      },
    });

    if (!booking || booking.paymentStatus !== 'PAID') return null;
    if (!booking.referralClientBenefitId) return null;
    if (Number(booking.referralDiscountPercent ?? 0) <= 0) return null;

    const existingUsage = await tx.referralClientDiscountUsage.findUnique({
      where: { bookingId: booking.id },
    });
    if (existingUsage) return existingUsage;

    const benefit = await tx.referralClientBenefit.findUnique({
      where: { id: booking.referralClientBenefitId },
      select: {
        id: true,
        remainingSessions: true,
        status: true,
      },
    });

    if (!benefit || benefit.status !== ReferralClientBenefitStatus.ACTIVE || benefit.remainingSessions <= 0) {
      return null;
    }

    const bookingPayment = params.bookingPaymentId
      ? await tx.bookingPayment.findFirst({
          where: {
            id: params.bookingPaymentId,
            bookingId: booking.id,
            status: 'PAID',
          },
          select: { id: true },
        })
      : await tx.bookingPayment.findFirst({
          where: {
            bookingId: booking.id,
            status: 'PAID',
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });

    if (!bookingPayment) return null;

    try {
      const usage = await tx.referralClientDiscountUsage.create({
        data: {
          benefitId: benefit.id,
          bookingId: booking.id,
          bookingPaymentId: bookingPayment.id,
          currency: booking.currency,
          discountPercent: this.money(booking.referralDiscountPercent),
          discountAmountBob: this.money(booking.referralDiscountAmountBob),
          discountAmountUsd: this.money(booking.referralDiscountAmountUsd),
        },
      });

      const remaining = Math.max(0, benefit.remainingSessions - 1);
      await tx.referralClientBenefit.update({
        where: { id: benefit.id },
        data: {
          remainingSessions: remaining,
          ...(remaining === 0
            ? {
                status: ReferralClientBenefitStatus.CONSUMED,
                consumedAt: new Date(),
              }
            : {}),
        },
      });

      return usage;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return tx.referralClientDiscountUsage.findUnique({ where: { bookingId: booking.id } });
      }

      throw error;
    }
  }

  async maybeRewardProfessionalReferralFromBookingEarning(
    tx: Prisma.TransactionClient,
    params: {
      bookingEarningId: string;
    },
  ) {
    const existing = await tx.referralProfessionalRewardEvent.findUnique({
      where: { bookingEarningId: params.bookingEarningId },
    });
    if (existing) return existing;

    const bookingEarning = await tx.bookingEarning.findUnique({
      where: { id: params.bookingEarningId },
      include: {
        client: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        bookingPayment: {
          select: {
            amountBob: true,
            amountUsd: true,
          },
        },
      },
    });

    if (!bookingEarning) return null;

    const beneficiary = await tx.referralProfessionalBeneficiary.findFirst({
      where: {
        referredUserId: bookingEarning.clientId,
        isActive: true,
      },
      select: {
        id: true,
        professionalReferrerId: true,
        rewardPercent: true,
      },
    });

    if (!beneficiary) return null;

    const rewardPercent = this.normalizePercent(Number(beneficiary.rewardPercent), 0);
    if (rewardPercent <= 0) return null;

    const sourceAmount = bookingEarning.currency === 'USD'
      ? this.money(bookingEarning.bookingPayment.amountUsd ?? bookingEarning.grossAmount)
      : this.money(bookingEarning.bookingPayment.amountBob ?? bookingEarning.grossAmount);

    if (sourceAmount.lessThanOrEqualTo(0)) return null;

    const rewardAmount = sourceAmount
      .mul(this.money(rewardPercent))
      .div(this.money(100))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    if (rewardAmount.lessThanOrEqualTo(0)) return null;

    const referrerWallet = await tx.wallet.upsert({
      where: { userId: beneficiary.professionalReferrerId },
      create: {
        userId: beneficiary.professionalReferrerId,
        balance: this.money(0),
        promotionalBalance: this.money(0),
        balanceUsd: this.money(0),
      },
      update: {},
    });

    if (bookingEarning.currency === 'USD') {
      await tx.wallet.update({
        where: { id: referrerWallet.id },
        data: { balanceUsd: { increment: rewardAmount } },
      });
    } else {
      await tx.wallet.update({
        where: { id: referrerWallet.id },
        data: { balance: { increment: rewardAmount } },
      });
    }

    const rewardTx = await tx.transaction.create({
      data: {
        walletId: referrerWallet.id,
        type: TransactionType.REFERRAL_PROFESSIONAL_REWARD,
        amount: rewardAmount,
        promotionalAmount: this.money(0),
        realAmount: rewardAmount,
        isPromotional: false,
        description: JSON.stringify({
          event: 'REFERRAL_PROFESSIONAL_BOOKING_REWARD',
          bookingEarningId: bookingEarning.id,
          bookingId: bookingEarning.bookingId,
          bookingPaymentId: bookingEarning.bookingPaymentId,
          referredUserId: bookingEarning.clientId,
          referredUserName: [bookingEarning.client.firstName, bookingEarning.client.lastName]
            .filter(Boolean)
            .join(' '),
          referredEmail: bookingEarning.client.email ?? null,
          professionalReferrerId: beneficiary.professionalReferrerId,
          sourceAmount: Number(sourceAmount),
          rewardPercent,
          currency: bookingEarning.currency,
        }),
      },
    });

    return tx.referralProfessionalRewardEvent.create({
      data: {
        beneficiaryId: beneficiary.id,
        bookingEarningId: bookingEarning.id,
        sourceTransactionId: bookingEarning.transactionId,
        rewardTransactionId: rewardTx.id,
        currency: bookingEarning.currency,
        sourceAmount,
        rewardPercent: this.money(rewardPercent),
        rewardAmount,
      },
    });
  }

  async maybeRewardProfessionalReferralFromBookingEarningDetached(params: {
    bookingEarningId: string;
  }) {
    try {
      return await this.prisma.$transaction(
        async (tx) =>
          this.maybeRewardProfessionalReferralFromBookingEarning(tx, {
            bookingEarningId: params.bookingEarningId,
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.referralProfessionalRewardEvent.findUnique({
          where: { bookingEarningId: params.bookingEarningId },
        });
      }

      throw error;
    }
  }

  async getAdminBonusTiers() {
    return this.prisma.referralBonusTier.findMany({ orderBy: { minActiveReferrals: 'asc' } });
  }

  async upsertAdminBonusTier(dto: {
    id?: string;
    label: string;
    minActiveReferrals: number;
    bonusPercent: number;
    isActive?: boolean;
  }) {
    if (dto.id) {
      return this.prisma.referralBonusTier.update({
        where: { id: dto.id },
        data: {
          label: dto.label,
          minActiveReferrals: dto.minActiveReferrals,
          bonusPercent: dto.bonusPercent,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    }
    return this.prisma.referralBonusTier.create({
      data: {
        label: dto.label,
        minActiveReferrals: dto.minActiveReferrals,
        bonusPercent: dto.bonusPercent,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async deleteAdminBonusTier(id: string) {
    await this.prisma.referralBonusTier.delete({ where: { id } });
    return { deleted: true };
  }

  async adminReverseReward(sourceTransactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.reverseReferralRewardBySourceTransaction(tx, sourceTransactionId);
      if (!result) {
        return { reversed: false, reason: 'No existe reward activo para esa transaccion fuente' };
      }
      return { reversed: true, eventId: result.id, reversedAt: result.reversedAt };
    });
  }

  async reverseReferralRewardBySourceTransaction(
    tx: Prisma.TransactionClient,
    sourceTransactionId: string,
  ) {
    const event = await tx.referralRewardEvent.findUnique({
      where: { sourceTransactionId },
      select: {
        id: true,
        reversedAt: true,
        rewardAmount: true,
        referral: { select: { referrerUserId: true } },
      },
    });

    if (!event) return null;
    if (event.reversedAt) return null;

    const rewardAmount = Number(event.rewardAmount);
    const referrerUserId = event.referral.referrerUserId;

    const referrerWallet = await tx.wallet.findUnique({ where: { userId: referrerUserId } });
    if (!referrerWallet) {
      this.logger.warn(`reverseReferralReward: wallet not found for referrer ${referrerUserId}`);
      return null;
    }

    const debitAmount = Math.min(rewardAmount, Math.max(0, Number(referrerWallet.balance)));
    if (debitAmount > 0) {
      await tx.wallet.update({
        where: { id: referrerWallet.id },
        data: { balance: { decrement: debitAmount } },
      });
    }

    const reversalTx = await tx.transaction.create({
      data: {
        walletId: referrerWallet.id,
        type: TransactionType.REFERRAL_REWARD_REVERSAL,
        amount: debitAmount,
        promotionalAmount: 0,
        realAmount: debitAmount,
        isPromotional: false,
        description: `Reverso de reward por tx fuente ${sourceTransactionId}`,
      },
    });

    return tx.referralRewardEvent.update({
      where: { id: event.id },
      data: {
        reversedAt: new Date(),
        reversalTransactionId: reversalTx.id,
      },
    });
  }

  async getMyReferrals(userId: string) {
    const rules = await this.getReferralRuleConfig();

    if (rules.validPurchasesRequired === 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.referral.updateMany({
          where: {
            referrerUserId: userId,
            status: ReferralStatus.PENDING,
          },
          data: {
            status: ReferralStatus.QUALIFIED,
            qualifiedAt: new Date(),
          },
        });
        await this.evaluateReferralBenefitsForReferrer(tx, userId);
      });
    }

    const [referralCode, me, rows] = await Promise.all([
      this.ensureUserReferralCode(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      }),
      this.prisma.referral.findMany({
        where: { referrerUserId: userId },
        orderBy: { createdAt: 'desc' },
        include: {
          referred: {
            select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true },
          },
          rewardEvents: {
            where: { reversedAt: null },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              rewardAmount: true,
              percentageApplied: true,
              bonusPercentApplied: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const validReferralsCount = rows.filter((r) => this.isValidReferralStatus(r.status)).length;
    const pendingReferralsCount = Math.max(0, rows.length - validReferralsCount);
    const cyclesUnlocked = Math.floor(validReferralsCount / rules.threshold);

    const clientBenefits =
      me?.role === UserRole.USER
        ? await this.prisma.referralClientBenefit.findMany({
            where: { referrerUserId: userId },
            orderBy: [{ status: 'asc' }, { cycleNumber: 'desc' }],
            select: {
              id: true,
              cycleNumber: true,
              status: true,
              discountPercent: true,
              totalSessions: true,
              remainingSessions: true,
              createdAt: true,
              activatedAt: true,
              consumedAt: true,
            },
          })
        : [];

    const professionalBeneficiaries = PROFESSIONAL_ROLES.includes(me?.role as UserRole)
      ? await this.prisma.referralProfessionalBeneficiary.findMany({
          where: {
            professionalReferrerId: userId,
            isActive: true,
          },
          orderBy: [{ activatedAt: 'asc' }],
          select: {
            id: true,
            referredUserId: true,
            rewardPercent: true,
            activatedAt: true,
            referredUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
          },
        })
      : [];

    const professionalRewards = PROFESSIONAL_ROLES.includes(me?.role as UserRole)
      ? await this.prisma.referralProfessionalRewardEvent.findMany({
          where: {
            beneficiary: {
              professionalReferrerId: userId,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            currency: true,
            sourceAmount: true,
            rewardPercent: true,
            rewardAmount: true,
            createdAt: true,
            reversedAt: true,
            beneficiary: {
              select: {
                referredUser: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const totalLegacyRewards = rows.reduce(
      (sum, r) => sum + r.rewardEvents.reduce((s, e) => s + Number(e.rewardAmount), 0),
      0,
    );

    const totalProfessionalRewards = professionalRewards
      .filter((r) => !r.reversedAt)
      .reduce((sum, r) => sum + Number(r.rewardAmount), 0);

    const totalRewards = totalLegacyRewards + totalProfessionalRewards;

    const activeClientBenefits = clientBenefits.filter((b) => b.status === ReferralClientBenefitStatus.ACTIVE);
    const clientRemainingSessions = activeClientBenefits.reduce((sum, b) => sum + b.remainingSessions, 0);

    return {
      code: referralCode,
      referralCode,
      role: me?.role ?? null,
      invitedCount: rows.length,
      totalInvites: rows.length,
      bonusCredits: totalRewards,
      totalBonusCredits: totalRewards,
      validReferralsCount,
      pendingReferralsCount,
      rules: {
        validPurchasesRequired: rules.validPurchasesRequired,
        threshold: rules.threshold,
        clientDiscountPercent: rules.clientDiscountPercent,
        clientDiscountSessions: rules.clientDiscountSessions,
        professionalRewardPercent: rules.professionalRewardPercent,
      },
      progress: {
        valid: validReferralsCount,
        threshold: rules.threshold,
        pending: pendingReferralsCount,
        cyclesUnlocked,
      },
      clientBenefit: me?.role === UserRole.USER
        ? {
            activeBenefits: activeClientBenefits.length,
            remainingDiscountSessions: clientRemainingSessions,
            benefits: clientBenefits.map((b) => ({
              id: b.id,
              cycleNumber: b.cycleNumber,
              status: b.status,
              discountPercent: Number(b.discountPercent),
              totalSessions: b.totalSessions,
              remainingSessions: b.remainingSessions,
              createdAt: b.createdAt,
              activatedAt: b.activatedAt,
              consumedAt: b.consumedAt,
            })),
          }
        : null,
      professionalBenefit: PROFESSIONAL_ROLES.includes(me?.role as UserRole)
        ? {
            activeBeneficiaries: professionalBeneficiaries.length,
            beneficiaries: professionalBeneficiaries.map((b) => ({
              id: b.id,
              referredUserId: b.referredUserId,
              rewardPercent: Number(b.rewardPercent),
              activatedAt: b.activatedAt,
              referredUser: {
                id: b.referredUser.id,
                fullName: [b.referredUser.firstName, b.referredUser.lastName].filter(Boolean).join(' '),
                email: b.referredUser.email,
                role: b.referredUser.role,
              },
            })),
            rewardsHistory: professionalRewards.map((r) => ({
              id: r.id,
              currency: r.currency,
              sourceAmount: Number(r.sourceAmount),
              rewardPercent: Number(r.rewardPercent),
              rewardAmount: Number(r.rewardAmount),
              createdAt: r.createdAt,
              reversedAt: r.reversedAt,
              referred: {
                id: r.beneficiary.referredUser.id,
                fullName: [r.beneficiary.referredUser.firstName, r.beneficiary.referredUser.lastName]
                  .filter(Boolean)
                  .join(' '),
                email: r.beneficiary.referredUser.email,
              },
            })),
          }
        : null,
      stats: {
        pending: rows.filter((r) => r.status === ReferralStatus.PENDING).length,
        active: rows.filter((r) => r.status === ReferralStatus.ACTIVE).length,
        qualified: rows.filter((r) => r.status === ReferralStatus.QUALIFIED).length,
        rewarded: rows.filter((r) => r.status === ReferralStatus.REWARDED).length,
        valid: validReferralsCount,
      },
      history: rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
        rewardedAt: r.rewardedAt,
        codeUsed: r.codeUsed,
        validPurchasesCount: r.validPurchasesCount,
        totalRewardCredits: r.rewardEvents.reduce((s, e) => s + Number(e.rewardAmount), 0),
        rewardEvents: r.rewardEvents.map((e) => ({
          id: e.id,
          rewardAmount: Number(e.rewardAmount),
          percentageApplied: Number(e.percentageApplied),
          bonusPercentApplied: Number(e.bonusPercentApplied),
          createdAt: e.createdAt,
        })),
        referred: {
          id: r.referred.id,
          fullName: [r.referred.firstName, r.referred.lastName].filter(Boolean).join(' '),
          email: r.referred.email,
          role: r.referred.role,
          createdAt: r.referred.createdAt,
        },
      })),
    };
  }

  async getAdminReferrals(query: AdminReferralsQueryDto) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    const where: Prisma.ReferralWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { codeUsed: { contains: query.search, mode: 'insensitive' } },
              {
                referrer: {
                  OR: [
                    { firstName: { contains: query.search, mode: 'insensitive' } },
                    { lastName: { contains: query.search, mode: 'insensitive' } },
                    { email: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              },
              {
                referred: {
                  OR: [
                    { firstName: { contains: query.search, mode: 'insensitive' } },
                    { lastName: { contains: query.search, mode: 'insensitive' } },
                    { email: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.referral.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      include: {
        referrer: { select: { id: true, firstName: true, lastName: true, email: true, referralCode: true, role: true } },
        referred: { select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true } },
        rewardEvents: {
          select: {
            id: true,
            rewardAmount: true,
            percentageApplied: true,
            bonusPercentApplied: true,
            sourceTransactionId: true,
            reversedAt: true,
            reversalTransactionId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) nextCursor = rows.pop()?.id ?? null;

    const [total, pending, active, qualified, rewarded, rewardEventsAgg] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.PENDING } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.ACTIVE } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.REWARDED } }),
      this.prisma.referralRewardEvent.aggregate({
        _sum: { rewardAmount: true },
        where: { reversedAt: null },
      }),
    ]);

    return {
      data: rows.map((r) => {
        const netRewards = r.rewardEvents
          .filter((e) => !e.reversedAt)
          .reduce((s, e) => s + Number(e.rewardAmount), 0);
        return {
          id: r.id,
          status: r.status,
          validPurchasesCount: r.validPurchasesCount,
          codeUsed: r.codeUsed,
          rewardCredits: netRewards,
          createdAt: r.createdAt,
          qualifiedAt: r.qualifiedAt,
          rewardedAt: r.rewardedAt,
          referrer: {
            id: r.referrer.id,
            fullName: [r.referrer.firstName, r.referrer.lastName].filter(Boolean).join(' '),
            email: r.referrer.email,
            referralCode: r.referrer.referralCode,
            role: r.referrer.role,
          },
          referred: {
            id: r.referred.id,
            fullName: [r.referred.firstName, r.referred.lastName].filter(Boolean).join(' '),
            email: r.referred.email,
            role: r.referred.role,
            createdAt: r.referred.createdAt,
          },
          rewardEvents: r.rewardEvents.map((e) => ({
            id: e.id,
            rewardAmount: Number(e.rewardAmount),
            percentageApplied: Number(e.percentageApplied),
            bonusPercentApplied: Number(e.bonusPercentApplied),
            sourceTransactionId: e.sourceTransactionId,
            reversedAt: e.reversedAt,
            reversalTransactionId: e.reversalTransactionId,
            createdAt: e.createdAt,
          })),
        };
      }),
      nextCursor,
      summary: {
        total,
        pending,
        active,
        qualified,
        rewarded,
        totalRewardCredits: Number(rewardEventsAgg._sum.rewardAmount ?? 0),
      },
    };
  }
}
