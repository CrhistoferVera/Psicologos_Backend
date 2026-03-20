import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyEarnings(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    const [todayResult, weekResult, transactions] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          walletId: wallet.id,
          type: 'EARNING',
          createdAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          walletId: wallet.id,
          type: 'EARNING',
          createdAt: { gte: startOfWeek },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.findMany({
        where: { walletId: wallet.id, type: 'EARNING' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const parsedTransactions = transactions.map((tx) => {
      let service = 'Transacción';
      let clientName = '';
      try {
        const meta = JSON.parse(tx.description ?? '{}');
        service = meta.service ?? service;
        clientName = meta.clientName ?? '';
      } catch {
        service = tx.description ?? 'Transacción';
      }
      return {
        id: tx.id,
        service,
        clientName,
        amount: Number(tx.amount),
        createdAt: tx.createdAt,
      };
    });

    return {
      balance: Number(wallet.balance),
      today: Number(todayResult._sum.amount ?? 0),
      thisWeek: Number(weekResult._sum.amount ?? 0),
      total: Number(wallet.balance),
      transactions: parsedTransactions,
    };
  }
}
