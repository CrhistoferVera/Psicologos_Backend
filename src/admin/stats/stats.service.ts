import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserRole, DepositStatus, WithdrawalStatus, TransactionType } from '@prisma/client';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      totalClients,
      activeClients,
      totalAnfitrionas,
      activeAnfitrionas,
      pendingDeposits,
      approvedDepositsToday,
      pendingWithdrawals,
      totalDepositRevenue,
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

      // Ingresos totales aprobados (suma de depósitos aprobados)
      this.prisma.depositRequest.aggregate({
        _sum: { amount: true },
        where: { status: DepositStatus.APPROVED },
      }),

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
        totalRevenue: Number(totalDepositRevenue._sum.amount ?? 0),
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
