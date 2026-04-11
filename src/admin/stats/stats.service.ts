import { Injectable } from '@nestjs/common';
import { DepositStatus, UserRole, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PROFESSIONAL_ROLE } from '../../common/professional-role';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getProfessionalStats(userId: string) {
    const CREDIT_TO_SOLES = Number(process.env.CREDIT_TO_SOLES_RATE ?? 1);

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return null;

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

    const toSoles = (credits: number) => +(credits * CREDIT_TO_SOLES).toFixed(2);

    const totalCredits = Number(totalEarnings._sum.amount ?? 0);
    const todayCredits = Number(todayEarnings._sum.amount ?? 0);
    const monthCredits = Number(monthEarnings._sum.amount ?? 0);
    const balanceCredits = Number(wallet.balance);

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

  // Compatibilidad temporal.
  async getAnfitrionaStats(userId: string) {
    return this.getProfessionalStats(userId);
  }

  async getStats() {
    const adminUserId = process.env.ADMIN_USER_ID;

    const adminWallet = await this.prisma.wallet.findUnique({
      where: { userId: adminUserId },
    });

    let totalRevenue = 0;
    if (adminWallet) {
      // TODO(finance-ledger): reemplazar este calculo por ledger contable definitivo.
      // Mantener exclusion de transacciones promocionales/no contables.
      const [newRevenue, legacyRevenue] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: {
            walletId: adminWallet.id,
            type: 'EARNING',
            isPromotional: false,
            realAmount: { gt: 0 },
          },
          _sum: { realAmount: true },
        }),
        this.prisma.transaction.aggregate({
          where: {
            walletId: adminWallet.id,
            type: 'EARNING',
            isPromotional: false,
            realAmount: 0,
          },
          _sum: { amount: true },
        }),
      ]);

      totalRevenue =
        Number(newRevenue._sum.realAmount ?? 0) +
        Number(legacyRevenue._sum.amount ?? 0);
    }

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
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.USER } }),
      this.prisma.user.count({ where: { role: UserRole.USER, isActive: true } }),
      this.prisma.user.count({ where: { role: PROFESSIONAL_ROLE } }),
      this.prisma.user.count({ where: { role: PROFESSIONAL_ROLE, isActive: true } }),
      this.prisma.depositRequest.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.depositRequest.count({
        where: {
          status: DepositStatus.APPROVED,
          updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      this.prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.PENDING } }),
      this.prisma.message.count(),
      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
    ]);

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
      // Compatibilidad temporal para frontend legacy.
      anfitrionas: {
        total: totalProfessionals,
        active: activeProfessionals,
        inactive: totalProfessionals - activeProfessionals,
      },
      deposits: {
        pending: pendingDeposits,
        approvedToday: approvedDepositsToday,
        totalRevenue,
      },
      withdrawals: {
        pending: pendingWithdrawals,
      },
      activity: {
        messages: totalMessages,
        messageUnlocks: 0,
        imageUnlocks: 0,
      },
    };
  }
}
