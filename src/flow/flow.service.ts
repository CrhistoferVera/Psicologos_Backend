import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { Prisma, TransactionType, DepositStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as querystring from 'querystring';

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly flowBaseUrl = 'https://www.flow.cl/api';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiKey = this.config.get<string>('FLOW_API_KEY') ?? '';
    this.secret = this.config.get<string>('FLOW_SECRET') ?? '';
  }

  // Genera la firma HMAC-SHA256 de los params ordenados
  private sign(params: Record<string, string>): string {
    const stringToSign = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return crypto
      .createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('hex');
  }

  async createPayment(
    userId: string,
    packageId: string,
  ): Promise<{ paymentUrl: string }> {
    const pkg = await this.prisma.package.findUnique({
      where: { id: packageId },
    });
    if (!pkg || !pkg.isActive)
      throw new NotFoundException('Paquete no encontrado o inactivo');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const backendUrl =
      this.config.get<string>('BACKEND_URL') ??
      'https://caja-negra-pacha-back.wkhbmg.easypanel.host';
    const appUrl =
      this.config.get<string>('APP_URL') ?? 'https://pacha-web.vercel.app';

    // Crear DepositRequest PENDING — su UUID (36 chars) será el commerceOrder
    const depositRequest = await this.prisma.depositRequest.create({
      data: {
        userId,
        packageId,
        packageNameAtMoment: pkg.name,
        creditsToDeliver: pkg.credits,
        amount: pkg.price,
        status: DepositStatus.PENDING,
        receiptUrl: 'flow:pending',
      },
    });

    // UUID = 36 chars, bien dentro del límite de 45 de Flow
    const commerceOrder = depositRequest.id;

    const params: Record<string, string> = {
      amount: Math.round(Number(pkg.price)).toString(),
      apiKey: this.apiKey,
      commerceOrder,
      currency: 'PEN',
      email: user.email ?? 'cliente@pachamama.com',
      subject: `${pkg.name} - ${pkg.credits} creditos`,
      urlConfirmation: `${backendUrl}/flow/confirm`,
      urlReturn: `${appUrl}/dashboard`,
    };

    params.s = this.sign(params);

    const postData = querystring.stringify(params);
    this.logger.log(`Creating Flow payment for user ${userId}, package ${packageId}`);

    const response = await fetch(`${this.flowBaseUrl}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
    });

    const data = await response.json();

    if (!data.url || !data.token) {
      // Limpiar el DepositRequest pendiente si Flow rechaza la creación
      await this.prisma.depositRequest.delete({ where: { id: depositRequest.id } });
      this.logger.error('Flow create error', JSON.stringify(data));
      throw new BadRequestException(
        data.message ?? 'Error al crear el pago con Flow',
      );
    }

    return { paymentUrl: `${data.url}?token=${data.token}` };
  }

  // Webhook que Flow llama server-to-server al confirmar el pago
  async confirmPayment(token: string): Promise<void> {
    // Consultar estado en Flow
    const statusParams: Record<string, string> = {
      apiKey: this.apiKey,
      token,
    };
    statusParams.s = this.sign(statusParams);

    const qs = querystring.stringify(statusParams);
    const response = await fetch(
      `${this.flowBaseUrl}/payment/getStatus?${qs}`,
    );
    const payment = await response.json();

    this.logger.log(`Flow getStatus response: ${JSON.stringify(payment)}`);

    // status 2 = pagado
    if (payment.status !== 2) {
      this.logger.warn(`Payment ${token} not paid, status: ${payment.status}`);
      return;
    }

    // commerceOrder = depositRequest.id (UUID)
    const depositRequestId: string = payment.commerceOrder ?? '';

    const depositRequest = await this.prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { package: true, user: { include: { wallet: true } } },
    });

    if (!depositRequest) {
      this.logger.error(`DepositRequest not found: ${depositRequestId}`);
      return;
    }

    // Idempotencia: ya fue aprobado
    if (depositRequest.status === DepositStatus.APPROVED) {
      this.logger.log(`DepositRequest ${depositRequestId} already approved, skipping`);
      return;
    }

    const pkg = depositRequest.package;
    const wallet = depositRequest.user?.wallet;

    if (!pkg || !wallet) {
      this.logger.error(`Package or wallet missing for depositRequest ${depositRequestId}`);
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.depositRequest.update({
          where: { id: depositRequestId },
          data: { status: DepositStatus.APPROVED, receiptUrl: `flow:${token}` },
        });

        const updatedWallet = await tx.wallet.update({
          where: { userId: depositRequest.userId },
          data: { balance: { increment: new Prisma.Decimal(pkg.credits) } },
        });

        await tx.transaction.create({
          data: {
            walletId: updatedWallet.id,
            depositRequestId,
            amount: new Prisma.Decimal(pkg.credits),
            type: TransactionType.DEPOSIT,
            description: `Recarga Flow: ${pkg.credits} creditos - ${pkg.name}`,
          },
        });
      });

      this.logger.log(`Wallet credited: ${pkg.credits} credits to user ${depositRequest.userId}`);
    } catch (error) {
      this.logger.error('Error crediting wallet after Flow payment', error);
      throw new InternalServerErrorException(
        'Pago recibido pero error al acreditar creditos',
      );
    }
  }
}
