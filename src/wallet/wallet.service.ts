import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AddBankAccountDto } from './dto/add-bank-account.dto';
import { CreateWithdrawalRequestDto } from './dto/create-withdrawal-request.dto';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private computeWithdrawableBalance(
    balance: Prisma.Decimal | number,
    promotionalBalance: Prisma.Decimal | number,
  ) {
    const total = Number(balance ?? 0);
    const promotional = Number(promotionalBalance ?? 0);
    return Math.max(total - promotional, 0);
  }

  async getMyBalance(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0, promotionalBalance: 0, balanceUsd: 0 },
      update: {},
    });
    return {
      balance: Number(wallet.balance ?? 0),
      balanceUsd: Number(wallet.balanceUsd ?? 0),
      promotionalBalance: Number(wallet.promotionalBalance ?? 0),
    };
  }

  async getMyEarnings(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0, promotionalBalance: 0, balanceUsd: 0 },
      update: {},
    });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    const [transactions, weekTransactions, withdrawalsEnabled] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          walletId: wallet.id,
          type: { in: [TransactionType.EARNING, TransactionType.REFERRAL_REWARD] },
          isPromotional: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.transaction.findMany({
        where: {
          walletId: wallet.id,
          type: { in: [TransactionType.EARNING, TransactionType.REFERRAL_REWARD] },
          isPromotional: false,
          createdAt: { gte: startOfWeek },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.systemConfigService.isWithdrawalsEnabled(),
    ]);

    const parseTransaction = (tx: (typeof transactions)[number]) => {
      let service = tx.type === TransactionType.REFERRAL_REWARD
        ? 'Recompensa por referido'
        : 'Ganancia por sesion';
      let clientName = '';
      let currency: 'BOB' | 'USD' = 'BOB';
      try {
        const meta = JSON.parse(tx.description ?? '{}');
        if (tx.type === TransactionType.REFERRAL_REWARD) {
          service = 'Recompensa por referido';
          clientName = meta.referredUserName ?? meta.referredEmail ?? '';
        } else if (meta.event === 'BOOKING_EARNING_CREDITED' || meta.event === 'SESSION_PAYMENT') {
          service = 'Ganancia por sesion';
          clientName = meta.clientName ?? '';
        } else {
          service = meta.service ?? service;
          clientName = meta.clientName ?? '';
        }
        const maybeCurrency = String(meta.currency ?? '').toUpperCase();
        if (maybeCurrency === 'USD') currency = 'USD';
      } catch {
        service = tx.description ?? 'Transaccion';
      }

      return {
        id: tx.id,
        service,
        clientName,
        amount: Number(tx.amount),
        currency,
        createdAt: tx.createdAt,
      };
    };

    const parsedTransactions = transactions.map(parseTransaction);
    const parsedWeekTransactions = weekTransactions.map(parseTransaction);

    const todayBob = parsedWeekTransactions
      .filter((tx) => tx.currency === 'BOB' && tx.createdAt >= startOfToday)
      .reduce((sum, tx) => sum + tx.amount, 0);
    const todayUsd = parsedWeekTransactions
      .filter((tx) => tx.currency === 'USD' && tx.createdAt >= startOfToday)
      .reduce((sum, tx) => sum + tx.amount, 0);
    const weekBob = parsedWeekTransactions
      .filter((tx) => tx.currency === 'BOB')
      .reduce((sum, tx) => sum + tx.amount, 0);
    const weekUsd = parsedWeekTransactions
      .filter((tx) => tx.currency === 'USD')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const promotionalBalance = Number(wallet.promotionalBalance ?? 0);
    const realBalance = this.computeWithdrawableBalance(wallet.balance, wallet.promotionalBalance ?? 0);

    return {
      balance: Number(wallet.balance),
      balanceUsd: Number(wallet.balanceUsd ?? 0),
      promotionalBalance,
      realBalance,
      withdrawableBalance: realBalance,
      withdrawalsEnabled,
      today: todayBob,
      todayUsd,
      thisWeek: weekBob,
      thisWeekUsd: weekUsd,
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
      currency: a.currency ?? 'BOB',
    }));
  }

  async addBankAccount(userId: string, dto: AddBankAccountDto) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Perfil profesional no encontrado');
    }

    const normalizedAccountNumber = dto.accountNumber.trim();
    const normalizedHolderName = dto.accountHolderName?.trim() || null;

    const duplicate = await this.prisma.bankAccount.findFirst({
      where: {
        userId,
        bankId: dto.bankId,
        accountNumber: normalizedAccountNumber,
      },
    });
    if (duplicate) {
      throw new BadRequestException('Esta cuenta bancaria ya esta registrada.');
    }

    const account = await this.prisma.bankAccount.create({
      data: {
        userId,
        bankId: dto.bankId,
        professionalProfileId: profile.id,
        accountNumber: normalizedAccountNumber,
        accountHolderName: normalizedHolderName,
        currency: dto.currency ?? 'BOB',
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
      currency: account.currency,
    };
  }

  async deleteBankAccount(userId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: BigInt(accountId), userId },
    });
    if (!account) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }

    const hasPendingWithdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: {
        bankAccountId: BigInt(accountId),
        status: 'PENDING',
      },
      select: { id: true },
    });
    if (hasPendingWithdrawal) {
      throw new BadRequestException('No puedes eliminar una cuenta con un retiro pendiente.');
    }

    await this.prisma.bankAccount.delete({ where: { id: BigInt(accountId) } });
    return { message: 'Cuenta eliminada' };
  }

  async createWithdrawalRequest(userId: string, dto: CreateWithdrawalRequestDto) {
    if (dto.credits <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }

    const method = dto.method ?? 'BANK_TRANSFER';
    const isCrypto = method === 'CRYPTO';

    // Validaciones según método
    if (!isCrypto) {
      if (!dto.bankAccountId || !/^\d+$/.test(dto.bankAccountId)) {
        throw new BadRequestException('ID de cuenta bancaria inválido.');
      }
    } else {
      if (!dto.cryptoAddress) {
        throw new BadRequestException('La dirección del wallet crypto es requerida.');
      }
      if (!dto.cryptoCurrency) {
        throw new BadRequestException('La criptomoneda es requerida.');
      }
      if (!dto.cryptoNetwork) {
        throw new BadRequestException('La red blockchain es requerida.');
      }
    }

    const withdrawalsEnabled = await this.systemConfigService.isWithdrawalsEnabled();
    if (!withdrawalsEnabled) {
      throw new BadRequestException('Los retiros se encuentran temporalmente deshabilitados.');
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('Wallet no encontrada');
    }

    const currency = dto.currency ?? 'BOB';
    const isUsd = currency === 'USD';

    const availableBalance = isUsd
      ? Number(wallet.balanceUsd ?? 0)
      : this.computeWithdrawableBalance(wallet.balance, wallet.promotionalBalance ?? 0);

    if (availableBalance < dto.credits) {
      throw new BadRequestException('Saldo disponible para retiro insuficiente.');
    }

    // Validar cuenta bancaria si aplica
    let bankAccount: Awaited<ReturnType<typeof this.prisma.bankAccount.findFirst>> = null;
    if (!isCrypto) {
      bankAccount = await this.prisma.bankAccount.findFirst({
        where: { id: BigInt(dto.bankAccountId!), userId },
      });
      if (!bankAccount) {
        throw new NotFoundException('Cuenta bancaria no encontrada');
      }
    }

    const payoutAmount = dto.credits;
    const payoutLabel = isUsd
      ? `$ ${payoutAmount.toFixed(2)} USD`
      : `Bs ${payoutAmount.toFixed(2)}`;

    const request = await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: isUsd
          ? { balanceUsd: { decrement: dto.credits } }
          : { balance: { decrement: dto.credits } },
      });

      const createdRequest = await tx.withdrawalRequest.create({
        data: {
          walletId: wallet.id,
          method,
          bankAccountId: !isCrypto ? BigInt(dto.bankAccountId!) : null,
          cryptoAddress: isCrypto ? dto.cryptoAddress : null,
          cryptoCurrency: isCrypto ? dto.cryptoCurrency : null,
          cryptoNetwork: isCrypto ? dto.cryptoNetwork : null,
          credits: dto.credits,
          soles: payoutAmount,
          currency,
          status: 'PENDING',
        },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: dto.credits,
          isPromotional: false,
          promotionalAmount: 0,
          realAmount: dto.credits,
          description: JSON.stringify({
            event: 'WITHDRAWAL_REQUEST_CREATED',
            withdrawalRequestId: createdRequest.id,
            method,
            credits: dto.credits,
            payoutAmount,
            currency,
            ...(isCrypto
              ? { cryptoAddress: dto.cryptoAddress, cryptoCurrency: dto.cryptoCurrency, cryptoNetwork: dto.cryptoNetwork }
              : { bankAccountId: dto.bankAccountId }
            ),
          }),
        },
      });

      return createdRequest;
    });

    const created = await this.prisma.withdrawalRequest.findUnique({
      where: { id: request.id },
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

    const professionalName =
      [professional?.firstName, professional?.lastName].filter(Boolean).join(' ') || 'Un profesional';
    const adminTokens = admins.map((a) => a.fcmToken!);

    const notifBody = isCrypto
      ? `${professionalName} solicito un retiro de ${payoutLabel} a wallet ${dto.cryptoCurrency} (${dto.cryptoNetwork})`
      : `${professionalName} solicito un retiro de ${payoutLabel}`;

    this.notificationsService.sendMulticastNotification(
      adminTokens,
      'Nueva solicitud de retiro',
      notifBody,
      { withdrawalRequestId: request.id, type: 'NEW_WITHDRAWAL_REQUEST' },
    );

    return {
      id: created!.id,
      method: created!.method,
      credits: Number(created!.credits),
      amountBs: Number(created!.soles),
      soles: Number(created!.soles),
      currency: created!.currency,
      status: created!.status,
      notes: created!.notes,
      rejectionReason: created!.rejectionReason,
      receiptUrl: created!.receiptUrl,
      // Banco
      bankName: created!.bankAccount?.bank.name ?? null,
      accountNumber: created!.bankAccount?.accountNumber ?? null,
      accountHolderName: created!.bankAccount?.accountHolderName ?? null,
      // Crypto
      cryptoAddress: created!.cryptoAddress ?? null,
      cryptoCurrency: created!.cryptoCurrency ?? null,
      cryptoNetwork: created!.cryptoNetwork ?? null,
      createdAt: created!.createdAt,
      updatedAt: created!.updatedAt,
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
      method: r.method,
      credits: Number(r.credits),
      amountBs: Number(r.soles),
      soles: Number(r.soles),
      currency: r.currency ?? 'BOB',
      status: r.status,
      notes: r.notes,
      rejectionReason: r.rejectionReason,
      receiptUrl: r.receiptUrl,
      txId: r.txId ?? null,
      bankName: r.bankAccount?.bank.name ?? null,
      accountNumber: r.bankAccount?.accountNumber ?? null,
      accountHolderName: r.bankAccount?.accountHolderName ?? null,
      cryptoAddress: r.cryptoAddress ?? null,
      cryptoCurrency: r.cryptoCurrency ?? null,
      cryptoNetwork: r.cryptoNetwork ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}
