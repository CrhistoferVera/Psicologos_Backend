import { Injectable } from '@nestjs/common';
import { DepositStatus, ReferralStatus, TransactionType, UserRole, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PROFESSIONAL_ROLE } from '../../common/professional-role';
import { SystemConfigService } from '../../system-config/system-config.service';

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private decimal(value: unknown): number {
    return Number(value ?? 0);
  }

  async getProfessionalStats(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return null;

    const runtimeConfig = await this.systemConfigService.getRuntimeConfig();
    const creditToSoles = runtimeConfig.creditToSolesRate;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalEarnings, todayEarnings, monthEarnings] = await Promise.all([
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { walletId: wallet.id, type: 'EARNING', isPromotional: false },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: {
          walletId: wallet.id,
          type: 'EARNING',
          isPromotional: false,
          createdAt: { gte: startOfToday },
        },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: {
          walletId: wallet.id,
          type: 'EARNING',
          isPromotional: false,
          createdAt: { gte: startOfMonth },
        },
      }),
    ]);

    const toSoles = (credits: number) => +(credits * creditToSoles).toFixed(2);

    const totalCredits = this.decimal(totalEarnings._sum.amount);
    const todayCredits = this.decimal(todayEarnings._sum.amount);
    const monthCredits = this.decimal(monthEarnings._sum.amount);
    const balanceCredits = this.decimal(wallet.balance);

    return {
      balance: {
        credits: balanceCredits,
        soles: toSoles(balanceCredits),
      },
      earnings: {
        total: { credits: totalCredits, soles: toSoles(totalCredits) },
        today: { credits: todayCredits, soles: toSoles(todayCredits) },
        thisMonth: { credits: monthCredits, soles: toSoles(monthCredits) },
      },
    };
  }

  async getAnfitrionaStats(userId: string) {
    return this.getProfessionalStats(userId);
  }

  async getStats() {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      totalClients,
      activeClients,
      totalProfessionals,
      activeProfessionals,
      pendingDeposits,
      approvedDepositsToday,
      pendingWithdrawals,
      totalMessages,
      newClientsThisMonth,
      depositReal,
      depositLegacy,
      promoGrants,
      referralRewardsTx,
      promoConsumed,
      platformEarningReal,
      platformEarningLegacy,
      professionalEarningReal,
      professionalEarningLegacy,
      referralsTotal,
      referralsPending,
      referralsQualified,
      referralsRewarded,
      referralRewardsSum,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.USER } }),
      this.prisma.user.count({ where: { role: UserRole.USER, isActive: true } }),
      this.prisma.user.count({ where: { role: PROFESSIONAL_ROLE } }),
      this.prisma.user.count({ where: { role: PROFESSIONAL_ROLE, isActive: true } }),
      this.prisma.depositRequest.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.depositRequest.count({
        where: {
          status: DepositStatus.APPROVED,
          updatedAt: { gte: startOfToday },
        },
      }),
      this.prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.PENDING } }),
      this.prisma.message.count(),
      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          createdAt: { gte: startOfMonth },
        },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.DEPOSIT, isPromotional: false, realAmount: { gt: 0 } },
        _sum: { realAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.DEPOSIT, isPromotional: false, realAmount: 0 },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.PROMOTIONAL_GRANT },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.REFERRAL_REWARD },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: { in: [TransactionType.MESSAGE_SEND, TransactionType.CALL_PAYMENT] },
          promotionalAmount: { gt: 0 },
        },
        _sum: { promotionalAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.EARNING,
          isPromotional: false,
          wallet: { user: { role: UserRole.ADMIN } },
          realAmount: { gt: 0 },
        },
        _sum: { realAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.EARNING,
          isPromotional: false,
          wallet: { user: { role: UserRole.ADMIN } },
          realAmount: 0,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.EARNING,
          isPromotional: false,
          wallet: { user: { role: PROFESSIONAL_ROLE } },
          realAmount: { gt: 0 },
        },
        _sum: { realAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.EARNING,
          isPromotional: false,
          wallet: { user: { role: PROFESSIONAL_ROLE } },
          realAmount: 0,
        },
        _sum: { amount: true },
      }),
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.PENDING } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.REWARDED } }),
      this.prisma.referral.aggregate({
        where: { status: ReferralStatus.REWARDED },
        _sum: { rewardCredits: true },
      }),
    ]);

    const grossRealRevenue = this.decimal(depositReal._sum.realAmount) + this.decimal(depositLegacy._sum.amount);
    const platformEarnings = this.decimal(platformEarningReal._sum.realAmount) + this.decimal(platformEarningLegacy._sum.amount);
    const professionalPaid =
      this.decimal(professionalEarningReal._sum.realAmount) + this.decimal(professionalEarningLegacy._sum.amount);

    const promotionalGranted = this.decimal(promoGrants._sum.amount) + this.decimal(referralRewardsTx._sum.amount);
    const promotionalConsumed = this.decimal(promoConsumed._sum.promotionalAmount);

    return {
      clients: {
        total: totalClients,
        active: activeClients,
        suspended: totalClients - activeClients,
        newThisMonth: newClientsThisMonth,
      },
      professionals: {
        total: totalProfessionals,
        active: activeProfessionals,
        inactive: totalProfessionals - activeProfessionals,
      },
      anfitrionas: {
        total: totalProfessionals,
        active: activeProfessionals,
        inactive: totalProfessionals - activeProfessionals,
      },
      deposits: {
        pending: pendingDeposits,
        approvedToday: approvedDepositsToday,
        totalRevenue: grossRealRevenue,
      },
      withdrawals: {
        pending: pendingWithdrawals,
      },
      activity: {
        messages: totalMessages,
        messageUnlocks: 0,
        imageUnlocks: 0,
      },
      finance: {
        grossRealRevenue,
        platformEarnings,
        professionalPaid,
        promotionalGranted,
        promotionalConsumed,
        referralRewards: this.decimal(referralRewardsSum._sum.rewardCredits),
      },
      referrals: {
        total: referralsTotal,
        pending: referralsPending,
        qualified: referralsQualified,
        rewarded: referralsRewarded,
        totalRewardCredits: this.decimal(referralRewardsSum._sum.rewardCredits),
      },
    };
  }
}
