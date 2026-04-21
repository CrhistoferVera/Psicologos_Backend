import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { DepositStatus, PaymentType } from '@prisma/client';
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

  // Crea o reutiliza el customer de Stripe para el usuario
  async getOrCreateCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.stripeCustomerId) return user.stripeCustomerId;

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
  async createPaymentIntent(userId: string, packageId: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw new NotFoundException('Paquete no encontrado');

    const customerId = await this.getOrCreateCustomer(userId);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(Number(pkg.price) * 100), // Stripe trabaja en centavos
      currency: 'usd',
      customer: customerId,
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

    return { clientSecret: paymentIntent.client_secret };
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
          description: `Recarga Stripe: ${deposit.packageNameAtMoment}`,
        },
      }),
    ]);
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
