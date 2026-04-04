import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceType, TransactionType } from '@prisma/client';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { PrismaService } from '../prisma.service';
import { ServicePricesService } from '../service-prices/service-prices.service';

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

  /**
   * Cobra créditos al cliente y los acredita a la anfitriona según la duración real de la llamada.
   * Si el cliente no tiene suficientes créditos, se cobra lo que tenga disponible.
   */
  async billCall(
    callerId: string,
    anfitrionaId: string,
    callType: 'CALL' | 'VIDEO_CALL',
    durationSeconds: number,
  ): Promise<{ creditsCharged: number; minutesBilled: number }> {
    if (durationSeconds < 1) return { creditsCharged: 0, minutesBilled: 0 };

    const serviceType = callType === 'VIDEO_CALL' ? ServiceType.VIDEO_CALL : ServiceType.CALL;
    const servicePrice = await this.servicePricesService.getPriceForUser(anfitrionaId, serviceType);

    if (!servicePrice || servicePrice.price <= 0) return { creditsCharged: 0, minutesBilled: 0 };

    const pricePerMinute = servicePrice.price;
    const minutes = Math.ceil(durationSeconds / 60);
    const totalCredits = minutes * pricePerMinute;

    const clientWallet = await this.prisma.wallet.findUnique({ where: { userId: callerId } });
    if (!clientWallet) return { creditsCharged: 0, minutesBilled: 0 };

    const available = Number(clientWallet.balance);
    const creditsToCharge = Math.min(totalCredits, available);
    if (creditsToCharge <= 0) return { creditsCharged: 0, minutesBilled: 0 };

    const anfitrionaWallet = await this.prisma.wallet.findUnique({ where: { userId: anfitrionaId } });
    if (!anfitrionaWallet) return { creditsCharged: 0, minutesBilled: 0 };

    const label = callType === 'VIDEO_CALL' ? 'Video llamada' : 'Llamada de voz';

    const adminUserId = this.config.get<string>('ADMIN_USER_ID');
    const feePct = Number(this.config.get<string>('PLATFORM_FEE_PERCENT') ?? '50') / 100;
    const total = Number(creditsToCharge);
    const adminShare = Math.round(total * feePct * 100) / 100;
    const anfitrionaShare = Math.round((total - adminShare) * 100) / 100;

    const adminWallet = adminUserId
      ? await this.prisma.wallet.findUnique({ where: { userId: adminUserId } })
      : null;

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId: callerId },
        data: { balance: { decrement: creditsToCharge } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: TransactionType.CALL_PAYMENT,
          amount: creditsToCharge,
          description: `${label} · ${minutes} min`,
        },
      }),
      this.prisma.wallet.update({
        where: { userId: anfitrionaId },
        data: { balance: { increment: anfitrionaShare } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: anfitrionaWallet.id,
          type: TransactionType.EARNING,
          amount: anfitrionaShare,
          description: JSON.stringify({ service: label, minutes }),
        },
      }),
      ...(adminWallet && adminShare > 0
        ? [
            this.prisma.wallet.update({
              where: { userId: adminUserId! },
              data: { balance: { increment: adminShare } },
            }),
            this.prisma.transaction.create({
              data: {
                walletId: adminWallet.id,
                type: TransactionType.EARNING,
                amount: adminShare,
                description: JSON.stringify({ service: `Comisión ${label}`, minutes }),
              },
            }),
          ]
        : []),
    ]);

    return { creditsCharged: creditsToCharge, minutesBilled: minutes };
  }
}
