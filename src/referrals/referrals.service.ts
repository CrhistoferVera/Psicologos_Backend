import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReferralCase,
  ReferralRewardType,
  ReferralStatus,
  TransactionType,
  UserRole,
} from '@prisma/client';
import { PROFESSIONAL_ROLES } from '../common/professional-role';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AdminReferralsQueryDto } from './dto/admin-referrals-query.dto';
import { createUniqueReferralCode } from './utils/referral-code.util';

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

  private isProfessional(role: UserRole): boolean {
    return PROFESSIONAL_ROLES.includes(role);
  }

  private resolveCase(referrerRole: UserRole, referredRole: UserRole): ReferralCase | null {
    if (this.isProfessional(referrerRole) && this.isProfessional(referredRole)) {
      return ReferralCase.PRO_TO_PRO;
    }
    if (this.isProfessional(referrerRole) && !this.isProfessional(referredRole)) {
      return ReferralCase.PRO_TO_USER;
    }
    if (!this.isProfessional(referrerRole) && !this.isProfessional(referredRole)) {
      return ReferralCase.USER_TO_USER;
    }
    return null;
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
      select: { id: true, firstName: true, lastName: true, referralCode: true, role: true },
    });

    if (!referrer) throw new BadRequestException('Codigo de referido invalido.');
    return referrer;
  }

  async createReferralLink(referredUserId: string, rawCode: string) {
    const referrer = await this.resolveReferrerByCode(rawCode);

    if (referrer.id === referredUserId) {
      throw new BadRequestException('No puedes usar tu propio codigo de referido.');
    }

    const referred = await this.prisma.user.findUnique({
      where: { id: referredUserId },
      select: { id: true, role: true },
    });

    if (!referred) throw new NotFoundException('Usuario referido no encontrado.');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.referral.findUnique({
        where: { referredUserId },
        select: { id: true, status: true },
      });

      if (existing) return existing;

      return tx.referral.create({
        data: {
          referrerUserId: referrer.id,
          referredUserId,
          codeUsed: referrer.referralCode as string,
          status: ReferralStatus.QUALIFIED,
          qualifiedAt: new Date(),
          referrerRole: referrer.role,
          referredRole: referred.role,
        },
        select: { id: true, status: true },
      });
    });
  }

  // ─── Caso 1: Psicólogo refiere a Psicólogo (sesiones) ────────────────────────
  // Busca si el profesional fue referido por otro psicólogo.
  // Retorna el referral con referrerUserId si aplica, null si no.
  async getReferralForProfessional(
    tx: Prisma.TransactionClient,
    professionalId: string,
  ) {
    return tx.referral.findUnique({
      where: { referredUserId: professionalId },
      select: {
        id: true,
        referrerUserId: true,
        referrerRole: true,
        referredRole: true,
      },
    });
  }

  // ─── Recompensa al referente desde una sesión ─────────────────────────────────
  async maybeRewardReferrerFromSession(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      bookingEarningId: string;
      clientId: string;
      professionalId: string;
      grossAmount: Prisma.Decimal;
      currency: string;
      rewardPercent: number;
    },
  ) {
    const { bookingId, bookingEarningId, clientId, professionalId, grossAmount, currency, rewardPercent } = params;

    // Caso 2 & 3: el cliente referido paga por primera vez (una sola vez)
    const clientReferral = await tx.referral.findUnique({
      where: { referredUserId: clientId },
      select: { id: true, referrerUserId: true, referrerRole: true, referredRole: true, rewardPaidAt: true },
    });

    if (clientReferral && !clientReferral.rewardPaidAt) {
      const referralCase = this.resolveCase(clientReferral.referrerRole, clientReferral.referredRole);
      if (referralCase === ReferralCase.PRO_TO_USER || referralCase === ReferralCase.USER_TO_USER) {
        await this.creditReferralReward(tx, {
          referralId: clientReferral.id,
          referrerUserId: clientReferral.referrerUserId,
          type: ReferralRewardType.SESSION,
          referralCase,
          currency,
          grossAmount,
          rewardPercent,
          bookingId,
          bookingEarningId,
          transactionType: TransactionType.REFERRAL_REWARD,
        });

        await tx.referral.update({
          where: { id: clientReferral.id },
          data: { rewardPaidAt: new Date() },
        });
      }
    }

    // Caso 1: el profesional fue referido por otro psicólogo (recurrente)
    const proReferral = await tx.referral.findUnique({
      where: { referredUserId: professionalId },
      select: { id: true, referrerUserId: true, referrerRole: true, referredRole: true },
    });

    if (proReferral) {
      const referralCase = this.resolveCase(proReferral.referrerRole, proReferral.referredRole);
      if (referralCase === ReferralCase.PRO_TO_PRO) {
        await this.creditReferralReward(tx, {
          referralId: proReferral.id,
          referrerUserId: proReferral.referrerUserId,
          type: ReferralRewardType.SESSION,
          referralCase,
          currency,
          grossAmount,
          rewardPercent,
          bookingId,
          bookingEarningId,
          transactionType: TransactionType.REFERRAL_REWARD,
        });
      }
    }
  }

  // ─── Recompensa al referente desde un paquete (solo casos 2 & 3, una vez) ────
  async maybeRewardReferrerFromPackage(
    tx: Prisma.TransactionClient,
    params: {
      depositRequestId: string;
      buyerUserId: string;
      grossAmount: Prisma.Decimal;
      currency: string;
      rewardPercent: number;
    },
  ) {
    const { depositRequestId, buyerUserId, grossAmount, currency, rewardPercent } = params;

    const referral = await tx.referral.findUnique({
      where: { referredUserId: buyerUserId },
      select: { id: true, referrerUserId: true, referrerRole: true, referredRole: true, rewardPaidAt: true },
    });

    if (!referral || referral.rewardPaidAt) return null;

    const referralCase = this.resolveCase(referral.referrerRole, referral.referredRole);
    if (referralCase !== ReferralCase.PRO_TO_USER && referralCase !== ReferralCase.USER_TO_USER) return null;

    await this.creditReferralReward(tx, {
      referralId: referral.id,
      referrerUserId: referral.referrerUserId,
      type: ReferralRewardType.PACKAGE,
      referralCase,
      currency,
      grossAmount,
      rewardPercent,
      depositRequestId,
      transactionType: TransactionType.REFERRAL_PACKAGE_REWARD,
    });

    await tx.referral.update({
      where: { id: referral.id },
      data: { rewardPaidAt: new Date() },
    });
  }

  // ─── Helper: acredita el monto al wallet del referente y registra el evento ──
  private async creditReferralReward(
    tx: Prisma.TransactionClient,
    params: {
      referralId: string;
      referrerUserId: string;
      type: ReferralRewardType;
      referralCase: ReferralCase;
      currency: string;
      grossAmount: Prisma.Decimal;
      rewardPercent: number;
      bookingId?: string;
      bookingEarningId?: string;
      depositRequestId?: string;
      transactionType: TransactionType;
    },
  ) {
    const { referralId, referrerUserId, type, referralCase, currency, grossAmount, rewardPercent, transactionType } = params;

    const rewardAmount = grossAmount
      .mul(this.money(rewardPercent))
      .div(this.money(100))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    if (rewardAmount.lessThanOrEqualTo(0)) return null;

    const referrerWallet = await tx.wallet.upsert({
      where: { userId: referrerUserId },
      create: { userId: referrerUserId, balance: this.money(0), promotionalBalance: this.money(0), balanceUsd: this.money(0) },
      update: {},
    });

    if (currency === 'USD') {
      await tx.wallet.update({ where: { id: referrerWallet.id }, data: { balanceUsd: { increment: rewardAmount } } });
    } else {
      await tx.wallet.update({ where: { id: referrerWallet.id }, data: { balance: { increment: rewardAmount } } });
    }

    const rewardTx = await tx.transaction.create({
      data: {
        walletId: referrerWallet.id,
        type: transactionType,
        amount: rewardAmount,
        promotionalAmount: this.money(0),
        realAmount: rewardAmount,
        isPromotional: false,
        description: JSON.stringify({
          event: type === ReferralRewardType.SESSION ? 'REFERRAL_SESSION_REWARD' : 'REFERRAL_PACKAGE_REWARD',
          referralCase,
          referralId,
          bookingId: params.bookingId ?? null,
          bookingEarningId: params.bookingEarningId ?? null,
          depositRequestId: params.depositRequestId ?? null,
          currency,
          sourceAmount: Number(grossAmount),
          rewardPercent,
          rewardAmount: Number(rewardAmount),
        }),
      },
    });

    return tx.referralReward.create({
      data: {
        referralId,
        type,
        case: referralCase,
        currency,
        sourceAmount: grossAmount,
        rewardPercent: this.money(rewardPercent),
        rewardAmount,
        bookingId: params.bookingId ?? null,
        bookingEarningId: params.bookingEarningId ?? null,
        depositRequestId: params.depositRequestId ?? null,
        transactionId: rewardTx.id,
      },
    });
  }

  // ─── Reversal de reward (admin) ───────────────────────────────────────────────
  async adminReverseReward(rewardId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.referralReward.findUnique({
        where: { id: rewardId },
        select: {
          id: true,
          type: true,
          reversedAt: true,
          rewardAmount: true,
          currency: true,
          transactionId: true,
          referral: { select: { referrerUserId: true } },
        },
      });

      if (!reward) return { reversed: false, reason: 'Reward no encontrado' };
      if (reward.reversedAt) return { reversed: false, reason: 'Ya fue revertido' };

      const rewardAmount = this.money(reward.rewardAmount);
      const referrerUserId = reward.referral.referrerUserId;

      const referrerWallet = await tx.wallet.findUnique({ where: { userId: referrerUserId } });
      if (!referrerWallet) return { reversed: false, reason: 'Wallet del referente no encontrada' };

      const debitAmount = reward.currency === 'USD'
        ? Prisma.Decimal.min(rewardAmount, Prisma.Decimal.max(this.money(0), this.money(referrerWallet.balanceUsd)))
        : Prisma.Decimal.min(rewardAmount, Prisma.Decimal.max(this.money(0), this.money(referrerWallet.balance)));

      if (debitAmount.greaterThan(0)) {
        if (reward.currency === 'USD') {
          await tx.wallet.update({ where: { id: referrerWallet.id }, data: { balanceUsd: { decrement: debitAmount } } });
        } else {
          await tx.wallet.update({ where: { id: referrerWallet.id }, data: { balance: { decrement: debitAmount } } });
        }
      }

      const transactionType = reward.type === ReferralRewardType.PACKAGE
        ? TransactionType.REFERRAL_PACKAGE_REWARD_REVERSAL
        : TransactionType.REFERRAL_REWARD_REVERSAL;

      const reversalTx = await tx.transaction.create({
        data: {
          walletId: referrerWallet.id,
          type: transactionType,
          amount: debitAmount,
          promotionalAmount: this.money(0),
          realAmount: debitAmount,
          isPromotional: false,
          description: `Reverso de referral reward ${rewardId}`,
        },
      });

      const updated = await tx.referralReward.update({
        where: { id: reward.id },
        data: { reversedAt: new Date(), reversalTransactionId: reversalTx.id },
      });

      return { reversed: true, rewardId: updated.id, reversedAt: updated.reversedAt };
    });
  }

  // ─── getMyReferrals ───────────────────────────────────────────────────────────
  async getMyReferrals(userId: string) {
    const config = await this.systemConfigService.getRuntimeConfig();

    const [referralCode, me, rows] = await Promise.all([
      this.ensureUserReferralCode(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }),
      this.prisma.referral.findMany({
        where: { referrerUserId: userId },
        orderBy: { createdAt: 'desc' },
        include: {
          referred: {
            select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true },
          },
          rewards: {
            where: { reversedAt: null },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              type: true,
              case: true,
              currency: true,
              sourceAmount: true,
              rewardPercent: true,
              rewardAmount: true,
              bookingId: true,
              depositRequestId: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const totalRewardsEarned = rows.reduce(
      (sum, r) => sum + r.rewards.reduce((s, e) => s + Number(e.rewardAmount), 0),
      0,
    );

    return {
      code: referralCode,
      referralCode,
      role: me?.role ?? null,
      invitedCount: rows.length,
      totalRewardsEarned,
      rules: {
        referralRewardPercent: config.referralRewardPercent,
      },
      history: rows.map((r) => ({
        id: r.id,
        status: r.status,
        referrerRole: r.referrerRole,
        referredRole: r.referredRole,
        case: this.resolveCase(r.referrerRole, r.referredRole),
        rewardPaidAt: r.rewardPaidAt,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
        referred: {
          id: r.referred.id,
          fullName: [r.referred.firstName, r.referred.lastName].filter(Boolean).join(' '),
          email: r.referred.email,
          role: r.referred.role,
          createdAt: r.referred.createdAt,
        },
        rewards: r.rewards.map((e) => ({
          id: e.id,
          type: e.type,
          case: e.case,
          currency: e.currency,
          sourceAmount: Number(e.sourceAmount),
          rewardPercent: Number(e.rewardPercent),
          rewardAmount: Number(e.rewardAmount),
          createdAt: e.createdAt,
        })),
      })),
    };
  }

  // ─── Admin: listar referidos ──────────────────────────────────────────────────
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
        rewards: {
          select: {
            id: true,
            type: true,
            case: true,
            currency: true,
            rewardAmount: true,
            reversedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) nextCursor = rows.pop()?.id ?? null;

    const [total, qualified] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
    ]);

    return {
      data: rows.map((r) => {
        const netRewards = r.rewards
          .filter((e) => !e.reversedAt)
          .reduce((s, e) => s + Number(e.rewardAmount), 0);
        return {
          id: r.id,
          status: r.status,
          referrerRole: r.referrerRole,
          referredRole: r.referredRole,
          case: this.resolveCase(r.referrerRole, r.referredRole),
          codeUsed: r.codeUsed,
          rewardPaidAt: r.rewardPaidAt,
          totalRewardsEarned: netRewards,
          createdAt: r.createdAt,
          qualifiedAt: r.qualifiedAt,
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
          rewards: r.rewards,
        };
      }),
      nextCursor,
      summary: { total, qualified },
    };
  }
}
