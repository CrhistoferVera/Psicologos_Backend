import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserRole, DepositStatus, WithdrawalStatus } from '@prisma/client';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getAnfitrionaStats(userId: string) {
    const CREDIT_TO_SOLES = Number(process.env.CREDIT_TO_SOLES_RATE ?? 1);

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return null;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalEarnings, todayEarnings, monthEarnings] = await Promise.all([
      // Ganancias totales
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { walletId: wallet.id, type: 'EARNING' },
      }),
      // Ganancias hoy
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { walletId: wallet.id, type: 'EARNING', createdAt: { gte: startOfToday } },
      }),
      // Ganancias este mes
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { walletId: wallet.id, type: 'EARNING', createdAt: { gte: startOfMonth } },
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

  async getStats() {
    const adminUserId = process.env.ADMIN_USER_ID;

    const adminWallet = await this.prisma.wallet.findUnique({
      where: { userId: adminUserId },
    });

    const [
      totalClients,
      activeClients,
      totalAnfitrionas,
      activeAnfitrionas,
      pendingDeposits,
      approvedDepositsToday,
      pendingWithdrawals,
      totalMessageUnlocks,
      totalImageUnlocks,
      newClientsThisMonth,
    ] = await Promise.all([
      // Total clientes
      this.prisma.user.count({ where: { role: UserRole.USER } }),

      // Clientes activos
      this.prisma.user.count({ where: { role: UserRole.USER, isActive: true } }),

      // Total anfitrionas
      this.prisma.user.count({ where: { role: UserRole.ANFITRIONA } }),

      // Anfitrionas activas
      this.prisma.user.count({ where: { role: UserRole.ANFITRIONA, isActive: true } }),

      // Recargas pendientes
      this.prisma.depositRequest.count({ where: { status: DepositStatus.PENDING } }),

      // Recargas aprobadas hoy
      this.prisma.depositRequest.count({
        where: {
          status: DepositStatus.APPROVED,
          updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),

      // Retiros pendientes de anfitrionas
      this.prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.PENDING } }),

      // Total desbloqueos de mensajes
      this.prisma.messageUnlock.count(),

      // Total desbloqueos de imágenes
      this.prisma.imageUnlock.count(),

      // Clientes nuevos este mes
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
      anfitrionas: {
        total: totalAnfitrionas,
        active: activeAnfitrionas,
        inactive: totalAnfitrionas - activeAnfitrionas,
      },
      deposits: {
        pending: pendingDeposits,
        approvedToday: approvedDepositsToday,
        totalRevenue: Number(adminWallet?.balance ?? 0),
      },
      withdrawals: {
        pending: pendingWithdrawals,
      },
      activity: {
        messageUnlocks: totalMessageUnlocks,
        imageUnlocks: totalImageUnlocks,
      },
    };
  }
}
