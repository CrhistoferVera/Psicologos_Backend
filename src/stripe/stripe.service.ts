import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { DepositStatus, PaymentType } from '@prisma/client';
import {
  BILLING_REGION_INTERNATIONAL,
  CURRENCY_USD,
} from '../common/phone-metadata.util';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Stripe = require('stripe');

@Injectable()
export class StripeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY')!);
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

  // Verifica la firma del webhook y devuelve el evento
  constructWebhookEvent(payload: Buffer, signature: string): any {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')!;
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      throw new BadRequestException('Webhook signature inválida');
    }
  }

  // Procesa el evento payment_intent.succeeded
  async handlePaymentSuccess(paymentIntentId: string) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { user: { include: { wallet: true } } },
    });

    if (!deposit || deposit.status !== DepositStatus.PENDING) return;

    const wallet = deposit.user.wallet;
    if (!wallet) return;

    // Bonus configurable desde .env para pagos con Stripe
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
        data: { balance: { increment: totalCredits } },
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

  // Procesa el evento payment_intent.payment_failed
  async handlePaymentFailed(paymentIntentId: string) {
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
