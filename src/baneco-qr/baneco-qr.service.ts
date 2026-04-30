import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DepositStatus, PaymentType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { BanecoApiService, PaymentQR } from './baneco-api.service';

@Injectable()
export class BanecoQrService {
  private readonly logger = new Logger(BanecoQrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly systemConfigService: SystemConfigService,
    private readonly banecoApi: BanecoApiService,
  ) {}

  private get usdToBob(): number {
    const raw = this.config.get<string>('BANECO_USD_TO_BOB');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 6.96;
  }

  private get currency(): 'BOB' | 'USD' {
    return (this.config.get<string>('BANECO_CURRENCY') as 'BOB' | 'USD') ?? 'BOB';
  }

  private get qrTtlDays(): number {
    const raw = this.config.get<string>('BANECO_QR_TTL_DAYS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  private buildDueDate(): string {
    const due = new Date();
    due.setDate(due.getDate() + this.qrTtlDays);
    return due.toISOString().slice(0, 10);
  }

  private async getOrCreateQrPaymentMethod() {
    let pm = await this.prisma.paymentMethod.findFirst({
      where: { type: PaymentType.QR, isActive: true },
    });
    if (!pm) {
      pm = await this.prisma.paymentMethod.create({
        data: { type: PaymentType.QR, isActive: true, bankName: 'Banco Economico' },
      });
    }
    return pm;
  }

  async createQrForPackage(userId: string, packageId: string) {
    const reqId = Math.random().toString(36).slice(2, 9);
    this.logger.log(`[QR][${reqId}] start userId=${userId} packageId=${packageId}`);

    const paymentsEnabled = await this.systemConfigService.isPaymentsEnabled();
    if (!paymentsEnabled) {
      this.logger.warn(`[QR][${reqId}] aborted reason=PAYMENTS_DISABLED`);
      throw new BadRequestException('Las recargas estan temporalmente deshabilitadas.');
    }

    const pkg = await this.prisma.package.findFirst({
      where: { id: packageId, isActive: true },
    });
    if (!pkg) {
      this.logger.warn(`[QR][${reqId}] aborted reason=PACKAGE_NOT_FOUND packageId=${packageId}`);
      throw new NotFoundException('Paquete no encontrado.');
    }

    const priceUsd = Number(pkg.price);
    const amount =
      this.currency === 'BOB' ? Math.round(priceUsd * this.usdToBob * 100) / 100 : priceUsd;

    this.logger.log(
      `[QR][${reqId}] package="${pkg.name}" priceUsd=${priceUsd} amount=${amount} currency=${this.currency} credits=${pkg.credits}`,
    );

    const pm = await this.getOrCreateQrPaymentMethod();

    const deposit = await this.prisma.depositRequest.create({
      data: {
        userId,
        packageId,
        paymentMethodId: pm.id,
        amount: pkg.price,
        creditsToDeliver: pkg.credits,
        packageNameAtMoment: pkg.name,
        status: DepositStatus.PENDING,
      },
    });

    try {
      this.logger.log(`[QR][${reqId}] calling Baneco generateQR depositId=${deposit.id}`);
      const qr = await this.banecoApi.generateQR({
        transactionId: deposit.id,
        amount,
        currency: this.currency,
        description: `SanaMente - ${pkg.name}`,
        dueDate: this.buildDueDate(),
        singleUse: true,
        modifyAmount: false,
      });

      await this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { bancoQrId: qr.qrId },
      });

      this.logger.log(`[QR][${reqId}] success depositId=${deposit.id} qrId=${qr.qrId}`);
      return {
        depositId: deposit.id,
        qrId: qr.qrId,
        qrImage: qr.qrImage,
        amount,
        currency: this.currency,
        credits: pkg.credits,
        packageName: pkg.name,
        dueDate: this.buildDueDate(),
      };
    } catch (err: any) {
      this.logger.error(
        `[QR][${reqId}] failed depositId=${deposit.id} reason=${err?.response?.code ?? err?.message ?? 'unknown'}`,
      );
      await this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.REJECTED, rejectionReason: 'Fallo al generar QR' },
      });
      throw err;
    }
  }

  async getStatus(userId: string, qrId: string) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: qrId },
    });
    if (!deposit || deposit.userId !== userId) {
      throw new NotFoundException('QR no encontrado.');
    }

    if (deposit.status === DepositStatus.APPROVED) {
      return { status: 'PAID' as const, depositId: deposit.id };
    }
    if (deposit.status === DepositStatus.REJECTED) {
      return { status: 'CANCELED' as const, depositId: deposit.id };
    }

    const remote = await this.banecoApi.statusQR(qrId);

    const paymentObj =
      remote.payment && !Array.isArray(remote.payment) ? remote.payment : null;

    if (remote.statusQrCode === 1) {
      await this.applyPaymentByQrId(qrId, paymentObj);
      return { status: 'PAID' as const, depositId: deposit.id };
    }
    if (remote.statusQrCode === 9) {
      await this.prisma.depositRequest.updateMany({
        where: { id: deposit.id, status: DepositStatus.PENDING },
        data: { status: DepositStatus.REJECTED, rejectionReason: 'QR anulado' },
      });
      return { status: 'CANCELED' as const, depositId: deposit.id };
    }

    return { status: 'PENDING' as const, depositId: deposit.id };
  }

  async cancel(userId: string, qrId: string) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: qrId },
    });
    if (!deposit || deposit.userId !== userId) {
      throw new NotFoundException('QR no encontrado.');
    }
    if (deposit.status !== DepositStatus.PENDING) {
      return { ok: true, alreadyResolved: true };
    }

    const res = await this.banecoApi.cancelQR(qrId);

    // Caso especial: el banco rechaza la cancelacion porque el QR ya fue pagado.
    // Lo tratamos como pago confirmado y acreditamos el wallet.
    if (res.responseCode !== 0 && /pagado/i.test(res.message ?? '')) {
      
      await this.applyPaymentByQrId(qrId, null);
      return { ok: true, paid: true };
    }

    if (res.responseCode !== 0) {
   
      throw new BadRequestException(res.message ?? 'No se pudo anular el QR');
    }

    await this.prisma.depositRequest.update({
      where: { id: deposit.id },
      data: { status: DepositStatus.REJECTED, rejectionReason: 'Cancelado por el usuario' },
    });
    return { ok: true };
  }

  async applyPaymentByQrId(qrId: string, payment: PaymentQR | null) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: qrId },
      include: { user: { include: { wallet: true } } },
    });
    if (!deposit) {

      return;
    }
    if (deposit.status !== DepositStatus.PENDING) return;

    const wallet = deposit.user.wallet;
    if (!wallet) {
   
      return;
    }

    const description = payment
      ? `Recarga QR Baneco: ${deposit.packageNameAtMoment} (txn ${payment.transactionId ?? deposit.id})`
      : `Recarga QR Baneco: ${deposit.packageNameAtMoment}`;

    await this.prisma.$transaction([
      this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.APPROVED },
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: deposit.creditsToDeliver } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          depositRequestId: deposit.id,
          type: 'DEPOSIT',
          amount: deposit.amount,
          realAmount: deposit.amount,
          description,
        },
      }),
    ]);
  }

  async reconcile(userId: string, qrId: string) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: qrId },
    });
    if (!deposit || deposit.userId !== userId) {
      throw new NotFoundException('QR no encontrado.');
    }
    if (deposit.status === DepositStatus.APPROVED) {
      return { ok: true, alreadyApplied: true };
    }

    // Intentamos cancelar: si el banco responde "ya pagado" -> confirmamos el pago.
    const res = await this.banecoApi.cancelQR(qrId);
    if (res.responseCode !== 0 && /pagado/i.test(res.message ?? '')) {
      await this.applyPaymentByQrId(qrId, null);
      return { ok: true, paid: true };
    }
    if (res.responseCode === 0) {
      return { ok: true, paid: false, message: 'QR estaba pendiente y fue anulado' };
    }
    return { ok: false, message: res.message };
  }

  async applyPayment(payment: PaymentQR) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: payment.qrId },
      include: { user: { include: { wallet: true } } },
    });
    if (!deposit) {
      this.logger.warn(`Pago QR ${payment.qrId} sin deposito asociado`);
      return;
    }
    if (deposit.status !== DepositStatus.PENDING) return;

    const wallet = deposit.user.wallet;
    if (!wallet) {
      this.logger.error(`Usuario ${deposit.userId} sin wallet al aplicar pago QR`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.APPROVED },
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: deposit.creditsToDeliver } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          depositRequestId: deposit.id,
          type: 'DEPOSIT',
          amount: deposit.amount,
          realAmount: deposit.amount,
          description: `Recarga QR Baneco: ${deposit.packageNameAtMoment}`,
        },
      }),
    ]);
  }
}
