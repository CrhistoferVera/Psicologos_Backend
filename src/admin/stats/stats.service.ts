import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserRole, DepositStatus, WithdrawalStatus } from '@prisma/client';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

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
      adminTotalRevenue,
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

      // Ganancias totales del admin (suma de todas las transacciones en su wallet)
      adminWallet
        ? this.prisma.transaction.aggregate({
            _sum: { amount: true },
            where: { walletId: adminWallet.id },
          })
        : Promise.resolve({ _sum: { amount: null } }),

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
        totalRevenue: Number(adminTotalRevenue._sum.amount ?? 0),
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
