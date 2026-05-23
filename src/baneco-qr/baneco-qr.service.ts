import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  DepositStatus,
  PaymentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { BanecoApiService, PaymentQR } from './baneco-api.service';
import { BILLING_REGION_BOLIVIA, CURRENCY_BOB } from '../common/phone-metadata.util';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingEarningsService } from '../booking-earnings/booking-earnings.service';
import { ReferralsService } from '../referrals/referrals.service';

@Injectable()
export class BanecoQrService {
  private readonly logger = new Logger(BanecoQrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly systemConfigService: SystemConfigService,
    private readonly banecoApi: BanecoApiService,
    private readonly notificationsService: NotificationsService,
    private readonly bookingEarningsService: BookingEarningsService,
    private readonly referralsService: ReferralsService,
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

  private newReqId() {
    return Math.random().toString(36).slice(2, 9);
  }

  private fullName(user?: { firstName?: string | null; lastName?: string | null }, fallback = 'Cliente') {
    const first = user?.firstName?.trim() ?? '';
    const last = user?.lastName?.trim() ?? '';
    const value = `${first} ${last}`.trim();
    return value || fallback;
  }

  private formatBookingDateTime(date: Date, timezone: string) {
    return new Intl.DateTimeFormat('es-BO', {
      timeZone: timezone || 'America/La_Paz',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private sanitizeProviderPayload(input: Record<string, unknown>) {
    return input;
  }

  private canUseBaneco(user: {
    billingRegion: string | null;
    preferredCurrency: string | null;
    phoneCountryIso: string | null;
  }) {
    const billingRegion = (user.billingRegion ?? '').trim().toUpperCase();
    const preferredCurrency = (user.preferredCurrency ?? '').trim().toUpperCase();
    const phoneCountryIso = (user.phoneCountryIso ?? '').trim().toUpperCase();
    return (
      billingRegion === BILLING_REGION_BOLIVIA ||
      preferredCurrency === CURRENCY_BOB ||
      phoneCountryIso === 'BO'
    );
  }

  async createQrForPackage(userId: string, packageId: string, reqId?: string) {
    const traceId = reqId ?? this.newReqId();
    this.logger.log(`[QR][${traceId}] start userId=${userId} packageId=${packageId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { billingRegion: true, preferredCurrency: true, phoneCountryIso: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    if (!this.canUseBaneco(user)) {
      this.logger.warn(`[QR][${traceId}] aborted reason=REGION_NOT_ALLOWED userId=${userId}`);
      throw new BadRequestException('El metodo QR Baneco no esta disponible para tu region.');
    }

    const paymentsEnabled = await this.systemConfigService.isPaymentsEnabled();
    if (!paymentsEnabled) {
      this.logger.warn(`[QR][${traceId}] aborted reason=PAYMENTS_DISABLED`);
      throw new BadRequestException('Las recargas estan temporalmente deshabilitadas.');
    }

    const pkg = await this.prisma.package.findFirst({
      where: { id: packageId, isActive: true },
    });
    if (!pkg) {
      this.logger.warn(`[QR][${traceId}] aborted reason=PACKAGE_NOT_FOUND packageId=${packageId}`);
      throw new NotFoundException('Paquete no encontrado.');
    }

    const priceUsd = Number(pkg.price);
    const amount =
      this.currency === 'BOB' ? Math.round(priceUsd * this.usdToBob * 100) / 100 : priceUsd;

    this.logger.log(
      `[QR][${traceId}] package="${pkg.name}" priceUsd=${priceUsd} amount=${amount} currency=${this.currency} credits=${pkg.credits}`,
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
      this.logger.log(`[QR][${traceId}] calling Baneco generateQR depositId=${deposit.id}`);
      const qr = await this.banecoApi.generateQR({
        transactionId: deposit.id,
        amount,
        currency: this.currency,
        description: `SanaMente - ${pkg.name}`,
        dueDate: this.buildDueDate(),
        singleUse: true,
        modifyAmount: false,
        reqId: traceId,
      });

      await this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { bancoQrId: qr.qrId },
      });

      this.logger.log(`[QR][${traceId}] success depositId=${deposit.id} qrId=${qr.qrId}`);
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
        `[QR][${traceId}] failed depositId=${deposit.id} reason=${err?.response?.code ?? err?.message ?? 'unknown'}`,
      );
      await this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.REJECTED, rejectionReason: 'Fallo al generar QR' },
      });
      throw err;
    }
  }

  async getStatus(userId: string, qrId: string, reqId?: string) {
    const traceId = reqId ?? this.newReqId();
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

    const remote = await this.banecoApi.statusQR(qrId, traceId);

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

  async cancel(userId: string, qrId: string, reqId?: string) {
    const traceId = reqId ?? this.newReqId();
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: qrId },
    });
    if (!deposit || deposit.userId !== userId) {
      throw new NotFoundException('QR no encontrado.');
    }
    if (deposit.status !== DepositStatus.PENDING) {
      return { ok: true, alreadyResolved: true };
    }

    const res = await this.banecoApi.cancelQR(qrId, traceId);

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
    this.logger.log(`[APPLY][${qrId}] start`);

    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: qrId },
      include: { user: { include: { wallet: true } } },
    });

    if (!deposit) {
      this.logger.warn(`[APPLY][${qrId}] no deposit found`);
      return;
    }
    this.logger.log(`[APPLY][${qrId}] deposit=${deposit.id} status=${deposit.status} creditsToDeliver=${deposit.creditsToDeliver}`);

    const wallet = deposit.user.wallet;
    if (!wallet) {
      this.logger.error(`[APPLY][${qrId}] user has no wallet userId=${deposit.userId}`);
      return;
    }
    this.logger.log(`[APPLY][${qrId}] wallet=${wallet.id} currentBalance=${wallet.balance}`);

    // Atomic claim: only the first concurrent call will get count=1
    const claimed = await this.prisma.depositRequest.updateMany({
      where: { id: deposit.id, status: DepositStatus.PENDING },
      data: { status: DepositStatus.APPROVED },
    });
    this.logger.log(`[APPLY][${qrId}] claimed.count=${claimed.count}`);
    if (claimed.count === 0) {
      this.logger.warn(`[APPLY][${qrId}] already claimed by another call, skipping`);
      return;
    }

    const description = payment
      ? `Recarga QR Baneco: ${deposit.packageNameAtMoment} (txn ${payment.transactionId ?? deposit.id})`
      : `Recarga QR Baneco: ${deposit.packageNameAtMoment}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: deposit.amount } },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          depositRequestId: deposit.id,
          type: 'DEPOSIT',
          amount: deposit.amount,
          realAmount: deposit.amount,
          description,
        },
      });
      const { referralRewardPercent, usdExchangeRate } = await this.systemConfigService.getRuntimeConfig();
      await this.referralsService.maybeRewardReferrerFromPackage(tx, {
        depositRequestId: deposit.id,
        buyerUserId: deposit.userId,
        grossAmount: new Prisma.Decimal(deposit.amount),
        currency: 'BOB',
        rewardPercent: referralRewardPercent,
        usdExchangeRate,
      });
    });
    this.logger.log(`[APPLY][${qrId}] wallet recharged +${deposit.amount} BOB`);
  }

  async reconcile(userId: string, qrId: string, reqId?: string) {
    const traceId = reqId ?? this.newReqId();
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
    const res = await this.banecoApi.cancelQR(qrId, traceId);
    if (res.responseCode !== 0 && /pagado/i.test(res.message ?? '')) {
      await this.applyPaymentByQrId(qrId, null);
      return { ok: true, paid: true };
    }
    if (res.responseCode === 0) {
      return { ok: true, paid: false, message: 'QR estaba pendiente y fue anulado' };
    }
    return { ok: false, message: res.message };
  }

  async createQrForBookingPayment(payload: {
    bookingId: string;
    bookingPaymentId: string;
    amountBob: number;
    currency: 'BOB';
    bookingExpiresAt: Date | null;
    requestId?: string;
  }) {
    const traceId = payload.requestId ?? this.newReqId();
    this.logger.log(
      `[QR-BOOKING][${traceId}] start bookingId=${payload.bookingId} bookingPaymentId=${payload.bookingPaymentId} amount=${payload.amountBob} currency=${payload.currency}`,
    );

    const qr = await this.banecoApi.generateQR({
      transactionId: payload.bookingPaymentId,
      amount: payload.amountBob,
      currency: payload.currency,
      description: `SanaMente Booking ${payload.bookingId.slice(0, 8)}`,
      dueDate: this.buildDueDate(),
      singleUse: true,
      modifyAmount: false,
      reqId: traceId,
    });

    await this.prisma.bookingPayment.update({
      where: { id: payload.bookingPaymentId },
      data: {
        providerReference: qr.qrId,
        providerPayload: this.sanitizeProviderPayload({
          provider: 'BANECO_QR',
          qrId: qr.qrId,
          responseCode: qr.responseCode,
          dueDate: this.buildDueDate(),
        }) as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `[QR-BOOKING][${traceId}] success bookingId=${payload.bookingId} bookingPaymentId=${payload.bookingPaymentId} qrId=${qr.qrId}`,
    );

    return {
      bookingId: payload.bookingId,
      paymentMethod: 'BANECO_QR' as const,
      currency: payload.currency,
      amount: payload.amountBob,
      qrImage: qr.qrImage,
      providerReference: qr.qrId,
      expiresAt: payload.bookingExpiresAt,
    };
  }

  async applyBookingPaymentByQrId(qrId: string, payment: PaymentQR | null) {
    const bookingPayment = await this.prisma.bookingPayment.findFirst({
      where: {
        method: BookingPaymentMethod.BANECO_QR,
        providerReference: qrId,
      },
      include: { booking: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!bookingPayment) return false;
    if (bookingPayment.status === BookingPaymentStatus.PAID) {
      await this.bookingEarningsService.creditProfessionalEarningForBooking({
        bookingId: bookingPayment.bookingId,
        bookingPaymentId: bookingPayment.id,
        source: 'BANECO_QR_NOTIFY',
      });
      return true;
    }

    const confirmedBookingForNotification = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.booking.findUnique({
        where: { id: bookingPayment.bookingId },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          expiresAt: true,
        },
      });

      if (!fresh) return;

      const now = new Date();
      const isExpired =
        fresh.status === BookingStatus.EXPIRED ||
        (fresh.expiresAt ? fresh.expiresAt <= now : false);

      if (isExpired) {
        await tx.booking.updateMany({
          where: {
            id: fresh.id,
            status: BookingStatus.PENDING_PAYMENT,
          },
          data: {
            status: BookingStatus.EXPIRED,
            paymentStatus: BookingPaymentStatus.EXPIRED,
          },
        });

        await tx.bookingPayment.updateMany({
          where: {
            id: bookingPayment.id,
            status: BookingPaymentStatus.PENDING,
          },
          data: {
            status: BookingPaymentStatus.EXPIRED,
            providerPayload: this.sanitizeProviderPayload({
              provider: 'BANECO_QR',
              qrId,
              latePaymentIgnored: true,
              bankTransactionId: payment?.transactionId ?? null,
            }) as Prisma.InputJsonValue,
          },
        });
        return null;
      }

      if (
        fresh.status === BookingStatus.CONFIRMED &&
        fresh.paymentStatus === BookingPaymentStatus.PAID
      ) {
        return null;
      }

      if (fresh.status !== BookingStatus.PENDING_PAYMENT) return null;

      await tx.bookingPayment.updateMany({
        where: {
          id: bookingPayment.id,
          status: BookingPaymentStatus.PENDING,
        },
        data: {
          status: BookingPaymentStatus.PAID,
          providerPayload: this.sanitizeProviderPayload({
            provider: 'BANECO_QR',
            qrId,
            paidAt: new Date().toISOString(),
            bankTransactionId: payment?.transactionId ?? null,
          }) as Prisma.InputJsonValue,
        },
      });

      const bookingUpdate = await tx.booking.updateMany({
        where: {
          id: fresh.id,
          status: BookingStatus.PENDING_PAYMENT,
          paymentStatus: BookingPaymentStatus.PENDING,
        },
        data: {
          status: BookingStatus.CONFIRMED,
          paymentStatus: BookingPaymentStatus.PAID,
          professionalPurchaseNotifiedAt: new Date(),
        },
      });

      if (bookingUpdate.count > 0) {
        return tx.booking.findUnique({
          where: { id: fresh.id },
          select: {
            id: true,
            timezone: true,
            scheduledStartAt: true,
            professional: {
              select: {
                fcmToken: true,
              },
            },
            client: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            sessionOffering: {
              select: {
                title: true,
              },
            },
          },
        });
      }
      return null;
    });

    if (confirmedBookingForNotification?.professional?.fcmToken) {
      const clientName = this.fullName(confirmedBookingForNotification.client);
      const scheduled = this.formatBookingDateTime(
        confirmedBookingForNotification.scheduledStartAt,
        confirmedBookingForNotification.timezone,
      );

      await this.notificationsService.sendPushNotification(
        confirmedBookingForNotification.professional.fcmToken,
        'Nueva sesion reservada',
        `${clientName} reservo ${confirmedBookingForNotification.sessionOffering.title} para ${scheduled}.`,
        {
          type: 'BOOKING_PURCHASE_CONFIRMED',
          bookingId: confirmedBookingForNotification.id,
          startsAt: confirmedBookingForNotification.scheduledStartAt.toISOString(),
        },
      );
    } else if (confirmedBookingForNotification) {
      this.logger.warn(
        `[QR-BOOKING] bookingId=${confirmedBookingForNotification.id} professional notification skipped: no FCM token`,
      );
    }

    await this.bookingEarningsService.creditProfessionalEarningForBooking({
      bookingId: bookingPayment.bookingId,
      bookingPaymentId: bookingPayment.id,
      source: 'BANECO_QR_NOTIFY',
    });

    return true;
  }

  async applyPayment(payment: PaymentQR) {
    const appliedToBooking = await this.applyBookingPaymentByQrId(payment.qrId, payment);
    if (appliedToBooking) return;

    // Primero intentar como SessionPayment
    const sessionPayment = await this.prisma.sessionPayment.findUnique({
      where: { bancoQrId: payment.qrId },
      include: {
        session: true,
        client: { include: { wallet: true } },
      },
    });

    if (sessionPayment) {
      await this.applySessionPaymentByQrId(payment.qrId);
      return;
    }

    // Fallback: DepositRequest normal
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { bancoQrId: payment.qrId },
      include: { user: { include: { wallet: true } } },
    });
    if (!deposit) {
      this.logger.warn(`Pago QR ${payment.qrId} sin deposito asociado`);
      return;
    }

    const wallet = deposit.user.wallet;
    if (!wallet) {
      this.logger.error(`Usuario ${deposit.userId} sin wallet al aplicar pago QR`);
      return;
    }

    // Atomic claim: only the first concurrent call will get count=1
    const claimed = await this.prisma.depositRequest.updateMany({
      where: { id: deposit.id, status: DepositStatus.PENDING },
      data: { status: DepositStatus.APPROVED },
    });
    if (claimed.count === 0) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: deposit.amount } },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          depositRequestId: deposit.id,
          type: 'DEPOSIT',
          amount: deposit.amount,
          realAmount: deposit.amount,
          description: `Recarga QR Baneco: ${deposit.packageNameAtMoment}`,
        },
      });
      const { referralRewardPercent, usdExchangeRate } = await this.systemConfigService.getRuntimeConfig();
      await this.referralsService.maybeRewardReferrerFromPackage(tx, {
        depositRequestId: deposit.id,
        buyerUserId: deposit.userId,
        grossAmount: new Prisma.Decimal(deposit.amount),
        currency: 'BOB',
        rewardPercent: referralRewardPercent,
        usdExchangeRate,
      });
    });
  }

  async createQrForSession(clientUserId: string, session: { id: string; title: string; priceInBs: any; priceInUsd: any; professionalUserId: string }) {
    const traceId = this.newReqId();
    this.logger.log(`[QR-SESSION][${traceId}] clientId=${clientUserId} sessionId=${session.id}`);

    const user = await this.prisma.user.findUnique({
      where: { id: clientUserId },
      select: { billingRegion: true, preferredCurrency: true, phoneCountryIso: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    if (!this.canUseBaneco(user)) {
      throw new BadRequestException('El metodo QR Baneco no esta disponible para tu region.');
    }

    const amountBs = Number(session.priceInBs);
    const amountUsd = Number(session.priceInUsd);

    // Crear o reutilizar SessionPayment
    let sessionPayment = await this.prisma.sessionPayment.findUnique({
      where: { sessionId_clientUserId: { sessionId: session.id, clientUserId } },
    });

    if (!sessionPayment) {
      sessionPayment = await this.prisma.sessionPayment.create({
        data: {
          sessionId: session.id,
          clientUserId,
          amountBs,
          amountUsd,
          currency: 'BOB',
          status: 'PENDING',
        },
      });
    } else if (sessionPayment.bancoQrId) {
      // Ya tiene QR, devolver el existente
      return {
        paymentId: sessionPayment.id,
        qrId: sessionPayment.bancoQrId,
        qrImage: null,
        amount: amountBs,
        currency: 'BOB',
        dueDate: this.buildDueDate(),
      };
    }

    try {
      const qr = await this.banecoApi.generateQR({
        transactionId: sessionPayment.id,
        amount: amountBs,
        currency: 'BOB',
        description: `SanaMente Sesion - ${session.title}`,
        dueDate: this.buildDueDate(),
        singleUse: true,
        modifyAmount: false,
        reqId: traceId,
      });

      await this.prisma.sessionPayment.update({
        where: { id: sessionPayment.id },
        data: { bancoQrId: qr.qrId },
      });

      this.logger.log(`[QR-SESSION][${traceId}] success paymentId=${sessionPayment.id} qrId=${qr.qrId}`);
      return {
        paymentId: sessionPayment.id,
        qrId: qr.qrId,
        qrImage: qr.qrImage,
        amount: amountBs,
        currency: 'BOB',
        dueDate: this.buildDueDate(),
      };
    } catch (err: any) {
      this.logger.error(`[QR-SESSION][${traceId}] failed reason=${err?.message ?? 'unknown'}`);
      throw err;
    }
  }

  async applySessionPaymentByQrId(qrId: string) {
    const sessionPayment = await this.prisma.sessionPayment.findUnique({
      where: { bancoQrId: qrId },
      include: {
        session: true,
        client: { include: { wallet: true } },
      },
    });
    if (!sessionPayment || sessionPayment.status !== 'PENDING') return;

    const professionalWallet = await this.prisma.wallet.findUnique({
      where: { userId: sessionPayment.session.professionalUserId },
    });
    if (!professionalWallet) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionPayment.update({
        where: { id: sessionPayment.id },
        data: { status: 'APPROVED' },
      });
      await tx.wallet.update({
        where: { id: professionalWallet.id },
        data: { balance: { increment: sessionPayment.amountBs } },
      });
      await tx.transaction.create({
        data: {
          walletId: professionalWallet.id,
          type: 'EARNING',
          amount: sessionPayment.amountBs,
          realAmount: sessionPayment.amountBs,
          isPromotional: false,
          promotionalAmount: 0,
          description: JSON.stringify({
            event: 'SESSION_PAYMENT',
            sessionId: sessionPayment.sessionId,
            sessionTitle: sessionPayment.session.title,
            clientUserId: sessionPayment.clientUserId,
            currency: 'BOB',
          }),
        },
      });
    });
  }
}
