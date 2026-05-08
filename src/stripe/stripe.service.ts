import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  DepositStatus,
  PaymentType,
  Prisma,
} from '@prisma/client';
import {
  BILLING_REGION_INTERNATIONAL,
  CURRENCY_USD,
} from '../common/phone-metadata.util';
import { BookingEarningsService } from '../booking-earnings/booking-earnings.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Stripe = require('stripe');

@Injectable()
export class StripeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly bookingEarningsService: BookingEarningsService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY')!);
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

  private canUseStripe(user: {
    billingRegion: string | null;
    preferredCurrency: string | null;
    phoneCountryIso: string | null;
  }) {
    const billingRegion = (user.billingRegion ?? '').trim().toUpperCase();
    const preferredCurrency = (user.preferredCurrency ?? '').trim().toUpperCase();
    const phoneCountryIso = (user.phoneCountryIso ?? '').trim().toUpperCase();
    return (
      billingRegion === BILLING_REGION_INTERNATIONAL ||
      preferredCurrency === CURRENCY_USD ||
      (phoneCountryIso.length > 0 && phoneCountryIso !== 'BO')
    );
  }

  // Crea o reutiliza el customer de Stripe para el usuario.
  // Si el ID guardado ya no existe en la cuenta Stripe actual (cuenta vieja/migración),
  // crea un customer nuevo y lo persiste para no volver a romper el flujo.
  async getOrCreateCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.stripeCustomerId) {
      try {
        const existing = await this.stripe.customers.retrieve(user.stripeCustomerId);
        if (!existing.deleted) return user.stripeCustomerId;
      } catch {
        // El customer no existe en Stripe para esta cuenta; limpiar ID y crear uno nuevo abajo.
        await this.prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: null },
        });
      }
    }

    const customer = await this.stripe.customers.create({
      email: user.email ?? undefined,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      metadata: { userId },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  // Crea el PaymentIntent y el DepositRequest en PENDING
  async createPaymentIntent(userId: string, packageId: string, saveCard = false) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { billingRegion: true, preferredCurrency: true, phoneCountryIso: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!this.canUseStripe(user)) {
      throw new BadRequestException('Stripe no esta disponible para tu region.');
    }

    const pkg = await this.prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw new NotFoundException('Paquete no encontrado');

    const customerId = await this.getOrCreateCustomer(userId);

    // Convertir BOB a USD usando la tasa de cambio del .env
    const bobToUsdRate = Number(this.config.get<string>('BOB_TO_USD_RATE')) || 7;
    const priceInUSD = Number(pkg.price) / bobToUsdRate;

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(priceInUSD * 100),
      currency: 'usd',
      customer: customerId,
      ...(saveCard && { setup_future_usage: 'off_session' }),
      metadata: { userId, packageId },
    });

    // Buscar el paymentMethod de tipo STRIPE
    let stripePaymentMethod = await this.prisma.paymentMethod.findFirst({
      where: { type: PaymentType.STRIPE, isActive: true },
    });

    // Si no existe lo crea automáticamente
    if (!stripePaymentMethod) {
      stripePaymentMethod = await this.prisma.paymentMethod.create({
        data: { type: PaymentType.STRIPE, isActive: true },
      });
    }

    await this.prisma.depositRequest.create({
      data: {
        userId,
        packageId,
        paymentMethodId: stripePaymentMethod.id,
        amount: pkg.price,
        creditsToDeliver: pkg.credits,
        packageNameAtMoment: pkg.name,
        stripePaymentIntentId: paymentIntent.id,
        status: DepositStatus.PENDING,
      },
    });

    return { clientSecret: paymentIntent.client_secret, customerId };
  }

  async createPaymentIntentForBooking(payload: {
    clientUserId: string;
    bookingId: string;
    bookingPaymentId: string;
    professionalId: string;
    amountUsd: number;
    amountBob: number;
    existingPaymentIntentId?: string | null;
    requestId?: string;
  }) {
    const reqId = payload.requestId ?? this.newReqId();
    this.logger.log(
      `[STRIPE-BOOKING][${reqId}] init bookingId=${payload.bookingId} bookingPaymentId=${payload.bookingPaymentId} amountUsd=${payload.amountUsd}`,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: payload.clientUserId },
      select: { billingRegion: true, preferredCurrency: true, phoneCountryIso: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!this.canUseStripe(user)) {
      throw new BadRequestException('Stripe no esta disponible para tu region.');
    }

    const customerId = await this.getOrCreateCustomer(payload.clientUserId);

    if (payload.existingPaymentIntentId) {
      try {
        const existingIntent = await this.stripe.paymentIntents.retrieve(
          payload.existingPaymentIntentId,
        );
        if (
          existingIntent &&
          existingIntent.status !== 'canceled' &&
          existingIntent.client_secret
        ) {
          const ephemeralKey = await this.createEphemeralKey(payload.clientUserId);
          const publishableKey = this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null;

          this.logger.log(
            `[STRIPE-BOOKING][${reqId}] reusing paymentIntent bookingId=${payload.bookingId} bookingPaymentId=${payload.bookingPaymentId} paymentIntentId=${existingIntent.id} status=${existingIntent.status}`,
          );

          return {
            bookingId: payload.bookingId,
            paymentMethod: 'STRIPE' as const,
            paymentIntentClientSecret: existingIntent.client_secret,
            customerId,
            ephemeralKey: ephemeralKey.secret,
            publishableKey,
            amount: payload.amountUsd,
            currency: 'USD' as const,
          };
        }
      } catch {
        this.logger.warn(
          `[STRIPE-BOOKING][${reqId}] existing paymentIntent unavailable bookingId=${payload.bookingId} paymentIntentId=${payload.existingPaymentIntentId}`,
        );
      }
    }

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(payload.amountUsd * 100),
      currency: 'usd',
      customer: customerId,
      metadata: {
        purpose: 'BOOKING',
        bookingId: payload.bookingId,
        bookingPaymentId: payload.bookingPaymentId,
        clientId: payload.clientUserId,
        professionalId: payload.professionalId,
      },
    });

    const ephemeralKey = await this.createEphemeralKey(payload.clientUserId);
    const publishableKey = this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null;

    await this.prisma.bookingPayment.update({
      where: { id: payload.bookingPaymentId },
      data: {
        providerReference: paymentIntent.id,
        providerPayload: this.sanitizeProviderPayload({
          provider: 'STRIPE',
          paymentIntentId: paymentIntent.id,
          amountUsd: payload.amountUsd,
          amountBob: payload.amountBob,
          customerId,
        }) as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `[STRIPE-BOOKING][${reqId}] created bookingId=${payload.bookingId} bookingPaymentId=${payload.bookingPaymentId} paymentIntentId=${paymentIntent.id}`,
    );

    return {
      bookingId: payload.bookingId,
      paymentMethod: 'STRIPE' as const,
      paymentIntentClientSecret: paymentIntent.client_secret,
      customerId,
      ephemeralKey: ephemeralKey.secret,
      publishableKey,
      amount: payload.amountUsd,
      currency: 'USD' as const,
    };
  }

  // Verifica la firma del webhook y devuelve el evento
  constructWebhookEvent(payload: Buffer, signature: string): any {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')!;
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      throw new BadRequestException('Webhook signature inválida');
    }
  }

  private async handleBookingPaymentSuccess(paymentIntentId: string): Promise<boolean> {
    const bookingPayment = await this.prisma.bookingPayment.findFirst({
      where: {
        method: BookingPaymentMethod.STRIPE,
        providerReference: paymentIntentId,
      },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            expiresAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!bookingPayment) return false;

    if (bookingPayment.status === BookingPaymentStatus.PAID) {
      await this.bookingEarningsService.creditProfessionalEarningForBooking({
        bookingId: bookingPayment.bookingId,
        bookingPaymentId: bookingPayment.id,
        source: 'STRIPE_WEBHOOK',
      });
      return true;
    }

    const confirmedBookingForNotification = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingPayment.bookingId },
        select: { id: true, status: true, paymentStatus: true, expiresAt: true },
      });
      if (!booking) return;

      const now = new Date();
      const isExpired =
        booking.status === BookingStatus.EXPIRED ||
        (booking.expiresAt ? booking.expiresAt <= now : false);

      if (isExpired) {
        await tx.booking.updateMany({
          where: {
            id: booking.id,
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
              provider: 'STRIPE',
              paymentIntentId,
              latePaymentIgnored: true,
            }) as Prisma.InputJsonValue,
          },
        });
        return null;
      }

      if (
        booking.status === BookingStatus.CONFIRMED &&
        booking.paymentStatus === BookingPaymentStatus.PAID
      ) {
        return null;
      }

      if (booking.status !== BookingStatus.PENDING_PAYMENT) return null;

      await tx.bookingPayment.updateMany({
        where: {
          id: bookingPayment.id,
          status: BookingPaymentStatus.PENDING,
        },
        data: {
          status: BookingPaymentStatus.PAID,
          providerPayload: this.sanitizeProviderPayload({
            provider: 'STRIPE',
            paymentIntentId,
            paidAt: new Date().toISOString(),
          }) as Prisma.InputJsonValue,
        },
      });

      const bookingUpdate = await tx.booking.updateMany({
        where: {
          id: booking.id,
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
          where: { id: booking.id },
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
        `[STRIPE-BOOKING] bookingId=${confirmedBookingForNotification.id} professional notification skipped: no FCM token`,
      );
    }

    await this.bookingEarningsService.creditProfessionalEarningForBooking({
      bookingId: bookingPayment.bookingId,
      bookingPaymentId: bookingPayment.id,
      source: 'STRIPE_WEBHOOK',
    });

    return true;
  }

  private async handleBookingPaymentFailed(paymentIntentId: string): Promise<boolean> {
    const bookingPayment = await this.prisma.bookingPayment.findFirst({
      where: {
        method: BookingPaymentMethod.STRIPE,
        providerReference: paymentIntentId,
      },
      include: { booking: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!bookingPayment) return false;
    if (bookingPayment.status !== BookingPaymentStatus.PENDING) return true;

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingPayment.update({
        where: { id: bookingPayment.id },
        data: {
          status: BookingPaymentStatus.FAILED,
          providerPayload: this.sanitizeProviderPayload({
            provider: 'STRIPE',
            paymentIntentId,
            failedAt: new Date().toISOString(),
          }) as Prisma.InputJsonValue,
        },
      });
    });

    return true;
  }

  async handlePaymentSuccess(paymentIntentId: string, metadata?: Record<string, string>) {
    const isBookingPayment = (metadata?.purpose ?? '').toUpperCase() === 'BOOKING';

    const handledBookingPayment = await this.handleBookingPaymentSuccess(paymentIntentId);
    if (handledBookingPayment) return;
    if (isBookingPayment) return;

    // Verificar si es pago de sesion
    const sessionPayment = await this.prisma.sessionPayment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { session: true },
    });

    if (sessionPayment) {
      if (sessionPayment.status !== 'PENDING') return;
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
          data: { balanceUsd: { increment: sessionPayment.amountUsd } },
        });
        await tx.transaction.create({
          data: {
            walletId: professionalWallet.id,
            type: 'EARNING',
            amount: sessionPayment.amountUsd,
            realAmount: sessionPayment.amountUsd,
            isPromotional: false,
            promotionalAmount: 0,
            description: JSON.stringify({
              event: 'SESSION_PAYMENT',
              sessionId: sessionPayment.sessionId,
              sessionTitle: sessionPayment.session.title,
              clientUserId: sessionPayment.clientUserId,
              currency: 'USD',
            }),
          },
        });
      });
      return;
    }

    // Fallback: DepositRequest normal
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { user: { include: { wallet: true } } },
    });

    if (!deposit || deposit.status !== DepositStatus.PENDING) return;

    const wallet = deposit.user.wallet;
    if (!wallet) return;

    const bonusPercentage = Number(this.config.get<string>('STRIPE_BONUS_PERCENTAGE')) || 0.35;
    const bonusCredits = Math.round(deposit.creditsToDeliver * bonusPercentage);
    const totalCredits = deposit.creditsToDeliver + bonusCredits;

    await this.prisma.$transaction([
      this.prisma.depositRequest.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.APPROVED },
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balanceUsd: { increment: totalCredits } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          depositRequestId: deposit.id,
          type: 'DEPOSIT',
          amount: deposit.amount,
          realAmount: deposit.amount,
          description: `Recarga Stripe: ${deposit.packageNameAtMoment} (${deposit.creditsToDeliver} + ${bonusCredits} bonus)`,
        },
      }),
    ]);
  }

  // Lista las tarjetas guardadas del usuario
  async getSavedPaymentMethods(userId: string) {
    const customerId = await this.getOrCreateCustomer(userId);
    const methods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return methods.data.map((pm: any) => ({
      id: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    }));
  }

  // Genera una ephemeral key para que el frontend pueda leer las tarjetas guardadas
  async createEphemeralKey(userId: string) {
    const customerId = await this.getOrCreateCustomer(userId);
    return this.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: this.config.get<string>('STRIPE_API_VERSION') ?? '2024-06-20' },
    );
  }

  async createPaymentIntentForSession(clientUserId: string, session: { id: string; title: string; priceInBs: any; priceInUsd: any; professionalUserId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: clientUserId },
      select: { billingRegion: true, preferredCurrency: true, phoneCountryIso: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!this.canUseStripe(user)) {
      throw new BadRequestException('Stripe no esta disponible para tu region.');
    }

    const amountUsd = Number(session.priceInUsd);
    const amountBs = Number(session.priceInBs);
    const customerId = await this.getOrCreateCustomer(clientUserId);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(amountUsd * 100),
      currency: 'usd',
      customer: customerId,
      metadata: { clientUserId, sessionId: session.id, type: 'SESSION' },
    });

    // Crear o reutilizar SessionPayment
    const existing = await this.prisma.sessionPayment.findUnique({
      where: { sessionId_clientUserId: { sessionId: session.id, clientUserId } },
    });

    if (!existing) {
      await this.prisma.sessionPayment.create({
        data: {
          sessionId: session.id,
          clientUserId,
          amountBs,
          amountUsd,
          currency: 'USD',
          status: 'PENDING',
          stripePaymentIntentId: paymentIntent.id,
        },
      });
    } else {
      await this.prisma.sessionPayment.update({
        where: { id: existing.id },
        data: { stripePaymentIntentId: paymentIntent.id },
      });
    }

    return { clientSecret: paymentIntent.client_secret, customerId };
  }

  // Procesa el evento payment_intent.payment_failed
  async handlePaymentFailed(paymentIntentId: string, metadata?: Record<string, string>) {
    const isBookingPayment = (metadata?.purpose ?? '').toUpperCase() === 'BOOKING';

    const handledBookingPayment = await this.handleBookingPaymentFailed(paymentIntentId);
    if (handledBookingPayment) return;
    if (isBookingPayment) return;

    await this.prisma.depositRequest.updateMany({
      where: {
        stripePaymentIntentId: paymentIntentId,
        status: DepositStatus.PENDING,
      },
      data: {
        status: DepositStatus.REJECTED,
        rejectionReason: 'Pago rechazado por Stripe',
      },
    });
  }
}
