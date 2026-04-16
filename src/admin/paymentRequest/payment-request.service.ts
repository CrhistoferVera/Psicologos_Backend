import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateWithdrawalRequetsDto } from './dto/update-withdrawalRequest.dto';
import { MailService } from 'src/mail/mail.service';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class RechargeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async updateDepositStatus(
    id: string,
    updateDto: UpdateWithdrawalRequetsDto,
    receiptData?: { url: string; publicId: string },
  ) {
    const { status, rejectionReason, notes } = updateDto;

    const withdrawalRequest = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: {
        wallet: {
          include: {
            user: {
              select: { email: true, firstName: true, fcmToken: true },
            },
          },
        },
      },
    });

    if (!withdrawalRequest) {
      throw new NotFoundException('La solicitud no existe.');
    }

    if (withdrawalRequest.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(`Esta solicitud ya fue procesada con estado: ${withdrawalRequest.status}`);
    }

    const credits = Number(withdrawalRequest.credits);

    if (status === WithdrawalStatus.REJECTED) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: withdrawalRequest.walletId },
          data: { balance: { increment: credits } },
        });

        await tx.transaction.create({
          data: {
            walletId: withdrawalRequest.walletId,
            amount: new Prisma.Decimal(credits),
            promotionalAmount: 0,
            realAmount: new Prisma.Decimal(credits),
            isPromotional: false,
            type: TransactionType.WITHDRAWAL,
            description: 'Devolucion por retiro rechazado',
          },
        });

        return tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: WithdrawalStatus.REJECTED,
            rejectionReason,
            notes: notes ?? null,
          },
        });
      });

      if (withdrawalRequest.wallet.user.email && withdrawalRequest.wallet.user.firstName) {
        this.mailService.sendWithdrawalRequestNotification(
          withdrawalRequest.wallet.user.email,
          withdrawalRequest.wallet.user.firstName,
          'REJECTED',
          credits,
          Number(withdrawalRequest.soles),
          rejectionReason,
        );
      }

      if (withdrawalRequest.wallet.user.fcmToken) {
        this.notificationsService.sendPushNotification(
          withdrawalRequest.wallet.user.fcmToken,
          'Solicitud de retiro rechazada',
          rejectionReason ?? 'Tu solicitud de retiro fue rechazada.',
          { withdrawalRequestId: id, type: 'WITHDRAWAL_REJECTED' },
        );
      }

      return { ...updated, bankAccountId: updated.bankAccountId.toString() };
    }

    if (status === WithdrawalStatus.APPROVED && !receiptData) {
      throw new BadRequestException('Debes subir el comprobante de pago para aprobar.');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedRequest = await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: WithdrawalStatus.APPROVED,
            rejectionReason: null,
            notes: notes ?? null,
            receiptUrl: receiptData!.url,
            receiptPublicId: receiptData!.publicId,
          },
        });

        await tx.transaction.create({
          data: {
            walletId: withdrawalRequest.walletId,
            amount: new Prisma.Decimal(credits),
            promotionalAmount: 0,
            realAmount: new Prisma.Decimal(credits),
            isPromotional: false,
            type: TransactionType.WITHDRAWAL,
            description: 'Retiro aprobado',
          },
        });

        return updatedRequest;
      });

      if (withdrawalRequest.wallet.user.email && withdrawalRequest.wallet.user.firstName) {
        this.mailService.sendWithdrawalRequestNotification(
          withdrawalRequest.wallet.user.email,
          withdrawalRequest.wallet.user.firstName,
          'APPROVED',
          credits,
          Number(withdrawalRequest.soles),
          null,
        );
      }

      if (withdrawalRequest.wallet.user.fcmToken) {
        this.notificationsService.sendPushNotification(
          withdrawalRequest.wallet.user.fcmToken,
          'Solicitud de retiro aprobada',
          `Tu retiro de ${credits} creditos fue procesado exitosamente.`,
          { withdrawalRequestId: id, type: 'WITHDRAWAL_APPROVED' },
        );
      }

      return {
        message: 'Retiro aprobado con exito.',
        request: {
          ...result,
          bankAccountId: result.bankAccountId.toString(),
          receipt: {
            url: result.receiptUrl,
            publicId: result.receiptPublicId,
          },
        },
      };
    } catch (error) {
      console.error('Error en transaccion de aprobacion:', error);
      throw new InternalServerErrorException('No se pudo procesar la aprobacion. Intente de nuevo.');
    }
  }
}
