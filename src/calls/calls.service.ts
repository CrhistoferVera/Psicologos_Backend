import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ServiceType, TransactionType } from '@prisma/client';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { PrismaService } from '../prisma.service';
import { ServicePricesService } from '../service-prices/service-prices.service';
import { allocateCreditDebit } from '../wallet/utils/credit-allocation.util';

@Injectable()
export class CallsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly servicePricesService: ServicePricesService,
  ) {}

  generateToken(channelName: string, uid: number): { token: string; appId: string } {
    const appId = this.config.get<string>('AGORA_APP_ID')!;
    const appCertificate = this.config.get<string>('AGORA_APP_CERTIFICATE')!;
    const expirationSeconds = 3600;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expirationSeconds,
      expirationSeconds,
    );

    return { token, appId };
  }

  async billCall(
    callerId: string,
    professionalId: string,
    callType: 'CALL' | 'VIDEO_CALL',
    durationSeconds: number,
  ): Promise<{ creditsCharged: number; minutesBilled: number; promotionalCreditsCharged: number; realCreditsCharged: number }> {
    if (durationSeconds < 1) {
      return { creditsCharged: 0, minutesBilled: 0, promotionalCreditsCharged: 0, realCreditsCharged: 0 };
    }

    const serviceType = callType === 'VIDEO_CALL' ? ServiceType.VIDEO_CALL : ServiceType.CALL;
    const servicePrice = await this.servicePricesService.getPriceForUser(professionalId, serviceType);

    if (!servicePrice || servicePrice.price <= 0) {
      return { creditsCharged: 0, minutesBilled: 0, promotionalCreditsCharged: 0, realCreditsCharged: 0 };
    }

    const pricePerMinute = servicePrice.price;
    const minutes = Math.ceil(durationSeconds / 60);
    const totalCredits = minutes * pricePerMinute;

    const clientWallet = await this.prisma.wallet.findUnique({ where: { userId: callerId } });
    if (!clientWallet) {
      return { creditsCharged: 0, minutesBilled: 0, promotionalCreditsCharged: 0, realCreditsCharged: 0 };
    }

    const available = Number(clientWallet.balance);
    const creditsToCharge = Math.min(totalCredits, available);
    if (creditsToCharge <= 0) {
      return { creditsCharged: 0, minutesBilled: 0, promotionalCreditsCharged: 0, realCreditsCharged: 0 };
    }

    const professionalWallet = await this.prisma.wallet.findUnique({ where: { userId: professionalId } });
    if (!professionalWallet) {
      return { creditsCharged: 0, minutesBilled: 0, promotionalCreditsCharged: 0, realCreditsCharged: 0 };
    }

    const label = callType === 'VIDEO_CALL' ? 'Video llamada' : 'Llamada de voz';
    const debit = allocateCreditDebit(
      Number(clientWallet.balance),
      Number(clientWallet.promotionalBalance),
      creditsToCharge,
    );

    const adminUserId = this.config.get<string>('ADMIN_USER_ID');
    const feePct = Number(this.config.get<string>('PLATFORM_FEE_PERCENT') ?? '50') / 100;
    const distributableCredits = debit.realDebited;
    const adminShare = Math.round(distributableCredits * feePct * 100) / 100;
    const professionalShare = Math.round((distributableCredits - adminShare) * 100) / 100;

    const adminWallet = adminUserId
      ? await this.prisma.wallet.findUnique({ where: { userId: adminUserId } })
      : null;

    const clientWalletUpdate: Prisma.WalletUpdateInput = {
      balance: { decrement: debit.totalDebited },
    };
    if (debit.promotionalDebited > 0) {
      clientWalletUpdate.promotionalBalance = { decrement: debit.promotionalDebited };
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.wallet.update({
        where: { userId: callerId },
        data: clientWalletUpdate,
      }),
      this.prisma.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: TransactionType.CALL_PAYMENT,
          amount: debit.totalDebited,
          promotionalAmount: debit.promotionalDebited,
          realAmount: debit.realDebited,
          isPromotional: debit.realDebited === 0,
          description: `${label} · ${minutes} min`,
        },
      }),
    ];

    if (professionalShare > 0) {
      operations.push(
        this.prisma.wallet.update({
          where: { userId: professionalId },
          data: { balance: { increment: professionalShare } },
        }),
        this.prisma.transaction.create({
          data: {
            walletId: professionalWallet.id,
            type: TransactionType.EARNING,
            amount: professionalShare,
            promotionalAmount: 0,
            realAmount: professionalShare,
            isPromotional: false,
            description: JSON.stringify({ service: label, minutes }),
          },
        }),
      );
    }

    if (adminWallet && adminShare > 0) {
      operations.push(
        this.prisma.wallet.update({
          where: { userId: adminUserId! },
          data: { balance: { increment: adminShare } },
        }),
        this.prisma.transaction.create({
          data: {
            walletId: adminWallet.id,
            type: TransactionType.EARNING,
            amount: adminShare,
            promotionalAmount: 0,
            realAmount: adminShare,
            isPromotional: false,
            description: JSON.stringify({ service: `Comision ${label}`, minutes }),
          },
        }),
      );
    }

    await this.prisma.$transaction(operations);

    return {
      creditsCharged: debit.totalDebited,
      minutesBilled: minutes,
      promotionalCreditsCharged: debit.promotionalDebited,
      realCreditsCharged: debit.realDebited,
    };
  }
}
