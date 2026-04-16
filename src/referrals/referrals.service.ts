import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralStatus, TransactionType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AdminReferralsQueryDto } from './dto/admin-referrals-query.dto';
import { createUniqueReferralCode } from './utils/referral-code.util';

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
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
      select: {
        id: true,
        firstName: true,
        lastName: true,
        referralCode: true,
      },
    });

    if (!referrer) {
      throw new BadRequestException('Codigo de referido invalido.');
    }

    return referrer;
  }

  async createReferralLink(referredUserId: string, rawCode: string) {
    const referrer = await this.resolveReferrerByCode(rawCode);

    if (referrer.id === referredUserId) {
      throw new BadRequestException('No puedes usar tu propio codigo de referido.');
    }

    const existing = await this.prisma.referral.findUnique({
      where: { referredUserId },
      select: { id: true, codeUsed: true },
    });

    if (existing) {
      if (existing.codeUsed === referrer.referralCode) return existing;
      throw new BadRequestException('Este usuario ya tiene un referido asociado.');
    }

    return this.prisma.referral.create({
      data: {
        referrerUserId: referrer.id,
        referredUserId,
        codeUsed: referrer.referralCode as string,
        status: ReferralStatus.PENDING,
      },
      select: { id: true, codeUsed: true, status: true },
    });
  }

  async maybeRewardReferralOnApprovedDeposit(
    tx: Prisma.TransactionClient,
    depositRequest: { id: string; userId: string; amount: Prisma.Decimal | number },
  ) {
    const config = await this.systemConfigService.getRuntimeConfig();
    if (!config.referralEnabled) return null;

    const referral = await tx.referral.findFirst({
      where: {
        referredUserId: depositRequest.userId,
        status: ReferralStatus.PENDING,
      },
      select: {
        id: true,
        referrerUserId: true,
      },
    });

    if (!referral) return null;

    const depositAmount = Number(depositRequest.amount);
    if (depositAmount < config.referralMinDepositAmount) return null;

    const now = new Date();

    const lock = await tx.referral.updateMany({
      where: {
        id: referral.id,
        status: ReferralStatus.PENDING,
        referredDepositRequestId: null,
      },
      data: {
        status: ReferralStatus.QUALIFIED,
        qualifiedAt: now,
        referredDepositRequestId: depositRequest.id,
      },
    });

    if (lock.count === 0) return null;

    const rewardCredits = Math.max(0, Math.round(config.referralRewardCredits * 100) / 100);

    if (rewardCredits <= 0) {
      return tx.referral.findUnique({ where: { id: referral.id } });
    }

    const wallet = await tx.wallet.upsert({
      where: { userId: referral.referrerUserId },
      update: {
        balance: { increment: rewardCredits },
        promotionalBalance: { increment: rewardCredits },
      },
      create: {
        userId: referral.referrerUserId,
        balance: rewardCredits,
        promotionalBalance: rewardCredits,
      },
    });

    const rewardTransaction = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.REFERRAL_REWARD,
        amount: rewardCredits,
        promotionalAmount: rewardCredits,
        realAmount: 0,
        isPromotional: true,
        description: `Recompensa por referido valido (${depositRequest.id})`,
      },
    });

    return tx.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.REWARDED,
        rewardCredits,
        rewardedAt: now,
        rewardTransactionId: rewardTransaction.id,
      },
    });
  }

  async getMyReferrals(userId: string) {
    const referralCode = await this.ensureUserReferralCode(userId);

    const rows = await this.prisma.referral.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        referred: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            createdAt: true,
          },
        },
      },
    });

    const invitedCount = rows.length;
    const pendingCount = rows.filter((item) => item.status === ReferralStatus.PENDING).length;
    const qualifiedCount = rows.filter((item) => item.status === ReferralStatus.QUALIFIED).length;
    const rewardedCount = rows.filter((item) => item.status === ReferralStatus.REWARDED).length;
    const bonusCredits = rows.reduce((sum, item) => sum + Number(item.rewardCredits), 0);

    return {
      code: referralCode,
      referralCode,
      invitedCount,
      totalInvites: invitedCount,
      bonusCredits,
      totalBonusCredits: bonusCredits,
      stats: {
        pending: pendingCount,
        qualified: qualifiedCount,
        rewarded: rewardedCount,
      },
      history: rows.map((item) => ({
        id: item.id,
        status: item.status,
        rewardCredits: Number(item.rewardCredits),
        createdAt: item.createdAt,
        qualifiedAt: item.qualifiedAt,
        rewardedAt: item.rewardedAt,
        codeUsed: item.codeUsed,
        referred: {
          id: item.referred.id,
          fullName: [item.referred.firstName, item.referred.lastName].filter(Boolean).join(' '),
          email: item.referred.email,
          createdAt: item.referred.createdAt,
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
        referrer: {
          select: { id: true, firstName: true, lastName: true, email: true, referralCode: true },
        },
        referred: {
          select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
        },
        referredDepositRequest: {
          select: { id: true, amount: true, status: true, createdAt: true, updatedAt: true },
        },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows.pop();
      nextCursor = last?.id ?? null;
    }

    const [total, pending, qualified, rewarded, rewardsSum] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.PENDING } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.REWARDED } }),
      this.prisma.referral.aggregate({
        _sum: { rewardCredits: true },
        where: { status: ReferralStatus.REWARDED },
      }),
    ]);

    return {
      data: rows.map((item) => ({
        id: item.id,
        status: item.status,
        codeUsed: item.codeUsed,
        rewardCredits: Number(item.rewardCredits),
        createdAt: item.createdAt,
        qualifiedAt: item.qualifiedAt,
        rewardedAt: item.rewardedAt,
        referrer: {
          id: item.referrer.id,
          fullName: [item.referrer.firstName, item.referrer.lastName].filter(Boolean).join(' '),
          email: item.referrer.email,
          referralCode: item.referrer.referralCode,
        },
        referred: {
          id: item.referred.id,
          fullName: [item.referred.firstName, item.referred.lastName].filter(Boolean).join(' '),
          email: item.referred.email,
          createdAt: item.referred.createdAt,
        },
        qualifyingDeposit: item.referredDepositRequest
          ? {
              id: item.referredDepositRequest.id,
              amount: Number(item.referredDepositRequest.amount),
              status: item.referredDepositRequest.status,
              createdAt: item.referredDepositRequest.createdAt,
              updatedAt: item.referredDepositRequest.updatedAt,
            }
          : null,
      })),
      nextCursor,
      summary: {
        total,
        pending,
        qualified,
        rewarded,
        totalRewardCredits: Number(rewardsSum._sum.rewardCredits ?? 0),
      },
    };
  }
}
