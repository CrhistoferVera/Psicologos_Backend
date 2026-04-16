import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async getMyEarnings(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0, promotionalBalance: 0 },
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
          isPromotional: false,
          createdAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          walletId: wallet.id,
          type: 'EARNING',
          isPromotional: false,
          createdAt: { gte: startOfWeek },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.findMany({
        where: { walletId: wallet.id, type: 'EARNING', isPromotional: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const parsedTransactions = transactions.map((tx) => {
      let service = 'Transaccion';
      let clientName = '';
      try {
        const meta = JSON.parse(tx.description ?? '{}');
        service = meta.service ?? service;
        clientName = meta.clientName ?? '';
      } catch {
        service = tx.description ?? 'Transaccion';
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

  async getBanks() {
    const banks = await this.prisma.banks.findMany({
      orderBy: { name: 'asc' },
    });
    return banks.map((b) => ({
      id: b.id,
      name: b.name,
      logoUrl: b.logo_url,
    }));
  }

  async getBankAccounts(userId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { userId },
      include: { bank: true },
      orderBy: { createdAt: 'desc' },
    });

    return accounts.map((a) => ({
      id: a.id.toString(),
      bankId: a.bankId,
      bankName: a.bank.name,
      bankLogoUrl: a.bank.logo_url,
      accountNumber: a.accountNumber,
      accountHolderName: a.accountHolderName,
    }));
  }

  async addBankAccount(
    userId: string,
    dto: { bankId: number; accountNumber: string; accountHolderName?: string },
  ) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Perfil profesional no encontrado');
    }

    const account = await this.prisma.bankAccount.create({
      data: {
        userId,
        bankId: dto.bankId,
        anfitrionaProfileId: profile.id,
        accountNumber: dto.accountNumber,
        accountHolderName: dto.accountHolderName,
      },
      include: { bank: true },
    });

    return {
      id: account.id.toString(),
      bankId: account.bankId,
      bankName: account.bank.name,
      bankLogoUrl: account.bank.logo_url,
      accountNumber: account.accountNumber,
      accountHolderName: account.accountHolderName,
    };
  }

  async deleteBankAccount(userId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: BigInt(accountId), userId },
    });
    if (!account) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }
    await this.prisma.bankAccount.delete({ where: { id: BigInt(accountId) } });
    return { message: 'Cuenta eliminada' };
  }

  async createWithdrawalRequest(
    userId: string,
    dto: { credits: number; bankAccountId: string },
  ) {
    if (dto.credits <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    const withdrawalsEnabled = await this.systemConfigService.isWithdrawalsEnabled();
    if (!withdrawalsEnabled) {
      throw new BadRequestException('Los retiros se encuentran temporalmente deshabilitados.');
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('Wallet no encontrada');
    }

    if (Number(wallet.balance) < dto.credits) {
      throw new BadRequestException('Saldo insuficiente');
    }

    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: BigInt(dto.bankAccountId), userId },
    });
    if (!bankAccount) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }

    const RATE = await this.systemConfigService.getCreditToSolesRate();
    const soles = dto.credits * RATE;

    const [, , request] = await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: dto.credits } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: dto.credits,
          isPromotional: false,
          promotionalAmount: 0,
          realAmount: dto.credits,
          description: JSON.stringify({ reason: 'Solicitud de retiro' }),
        },
      }),
      this.prisma.withdrawalRequest.create({
        data: {
          walletId: wallet.id,
          bankAccountId: BigInt(dto.bankAccountId),
          credits: dto.credits,
          soles,
          status: 'PENDING',
        },
      }),
    ]);

    const created = await this.prisma.withdrawalRequest.findUnique({
      where: { id: (request as any).id },
      include: { bankAccount: { include: { bank: true } } },
    });

    const [professional, admins] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true, fcmToken: { not: null } },
        select: { fcmToken: true },
      }),
    ]);

    const professionalName = [professional?.firstName, professional?.lastName].filter(Boolean).join(' ') || 'Un profesional';
    const adminTokens = admins.map((a) => a.fcmToken!);

    this.notificationsService.sendMulticastNotification(
      adminTokens,
      'Nueva solicitud de retiro',
      `${professionalName} solicito un retiro de ${dto.credits} creditos (S/ ${soles.toFixed(2)})`,
      { withdrawalRequestId: (request as any).id, type: 'NEW_WITHDRAWAL_REQUEST' },
    );

    return {
      id: created!.id,
      credits: Number(created!.credits),
      soles: Number(created!.soles),
      status: created!.status,
      bankName: created!.bankAccount.bank.name,
      accountNumber: created!.bankAccount.accountNumber,
      createdAt: created!.createdAt,
    };
  }

  async getWithdrawalRequests(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return [];

    const requests = await this.prisma.withdrawalRequest.findMany({
      where: { walletId: wallet.id },
      include: { bankAccount: { include: { bank: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((r) => ({
      id: r.id,
      credits: Number(r.credits),
      soles: Number(r.soles),
      status: r.status,
      notes: r.notes,
      rejectionReason: r.rejectionReason,
      receiptUrl: r.receiptUrl,
      bankName: r.bankAccount.bank.name,
      accountNumber: r.bankAccount.accountNumber,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}
