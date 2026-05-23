import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { DepositStatus, Prisma, UserRole, TransactionType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateDepositStatusDto } from './dto/update-depositsRequest.dto';
import { MailService } from 'src/mail/mail.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { ReferralsService } from '../../referrals/referrals.service';

@Injectable()
export class RechargeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly systemConfig: SystemConfigService,
    private readonly referralsService: ReferralsService,
  ) {}

  async getAllRechargeRequests(search?: string, cursor?: string, limit = 10) {
    try {
      const whereCondition: Prisma.DepositRequestWhereInput = {
        user: {
          role: UserRole.USER,
          ...(search && {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search } },
            ],
          }),
        },
      };

      const solicitudesRecharge = await this.prisma.depositRequest.findMany({
        where: whereCondition,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
            },
          },
          package: {
            select: {
              name: true,
              price: true,
            },
          },
          paymentMethod: {
            select: {
              type: true,
            },
          },
        },
        orderBy: { id: 'desc' },
        take: limit + 1,
        ...(cursor && {
          skip: 1,
          cursor: { id: cursor },
        }),
      });

      let nextCursor: string | null = null;

      if (solicitudesRecharge.length > limit) {
        solicitudesRecharge.pop();
        nextCursor = solicitudesRecharge[solicitudesRecharge.length - 1].id;
      }

      return {
        requests: solicitudesRecharge.map((item) => ({
          ...item,
          amountBs: Number(item.amount),
        })),
        nextCursor,
      };
    } catch (error) {
      console.error('Error en getAllRechargeRequests:', error);
      throw new InternalServerErrorException('Error al obtener las solicitudes de recarga');
    }
  }

  async updateDepositStatus(id: string, updateDto: UpdateDepositStatusDto) {
    const { status, rejectionReason } = updateDto;

    const depositRequest = await this.prisma.depositRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            email: true,
            firstName: true,
            id: true,
          },
        },
      },
    });

    if (!depositRequest) {
      throw new NotFoundException('La solicitud de recarga no existe.');
    }

    if (depositRequest.status !== DepositStatus.PENDING) {
      throw new BadRequestException(`Esta solicitud ya fue procesada y tiene estado: ${depositRequest.status}`);
    }

    if (!depositRequest.user.email || !depositRequest.user.firstName) {
      throw new InternalServerErrorException('Los datos del usuario estan incompletos para enviar la notificacion.');
    }

    if (status === DepositStatus.REJECTED) {
      const updated = await this.prisma.depositRequest.update({
        where: { id },
        data: {
          status: DepositStatus.REJECTED,
          rejectionReason,
        },
      });

      this.mailService.sendDepositStatusNotification(
        depositRequest.user.email,
        depositRequest.user.firstName,
        'REJECTED',
        0,
        rejectionReason,
      );

      return updated;
    }

    const packageName = depositRequest.packageNameAtMoment || 'Paquete';
    const isStripePayment = depositRequest.stripePaymentIntentId != null;
    const amountBob = Number(depositRequest.amount);

    const { usdExchangeRate } = await this.systemConfig.getRuntimeConfig();
    const usdRate = usdExchangeRate > 0 ? usdExchangeRate : 7;
    const walletIncrement = isStripePayment ? amountBob / usdRate : amountBob;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedRequest = await tx.depositRequest.update({
          where: { id },
          data: {
            status: DepositStatus.APPROVED,
            rejectionReason: null,
          },
        });

        const updatedWallet = await tx.wallet.update({
          where: { userId: depositRequest.userId },
          data: isStripePayment
            ? { balanceUsd: { increment: new Prisma.Decimal(walletIncrement) } }
            : { balance: { increment: new Prisma.Decimal(walletIncrement) } },
        });

        await tx.transaction.create({
          data: {
            walletId: updatedWallet.id,
            depositRequestId: depositRequest.id,
            amount: new Prisma.Decimal(walletIncrement),
            promotionalAmount: new Prisma.Decimal(0),
            realAmount: new Prisma.Decimal(walletIncrement),
            isPromotional: false,
            type: TransactionType.DEPOSIT,
            description: `Recarga aprobada: ${isStripePayment ? `$${walletIncrement.toFixed(2)} USD` : `Bs ${walletIncrement.toFixed(2)}`} - Paquete ${packageName}`,
          },
        });

        const { referralRewardPercent, usdExchangeRate } = await this.systemConfig.getRuntimeConfig();
        await this.referralsService.maybeRewardReferrerFromPackage(tx, {
          depositRequestId: depositRequest.id,
          buyerUserId: depositRequest.userId,
          grossAmount: new Prisma.Decimal(walletIncrement),
          currency: isStripePayment ? 'USD' : 'BOB',
          rewardPercent: referralRewardPercent,
          usdExchangeRate,
        });

        return {
          message: 'Deposito aprobado con exito. Saldo actualizado.',
          request: updatedRequest,
        };
      });

      this.mailService.sendDepositStatusNotification(
        depositRequest.user.email,
        depositRequest.user.firstName,
        'APPROVED',
        walletIncrement,
        null,
      );

      return result;
    } catch (error) {
      console.error('Error en transaccion de aprobacion:', error);
      throw new InternalServerErrorException('No se pudo procesar la aprobacion. Intente de nuevo.');
    }
  }
}
