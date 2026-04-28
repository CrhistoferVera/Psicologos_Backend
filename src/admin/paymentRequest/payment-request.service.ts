import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateWithdrawalRequestDto } from './dto/update-withdrawal-request.dto';
import { MailService } from 'src/mail/mail.service';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async updateWithdrawalStatus(
    id: string,
    updateDto: UpdateWithdrawalRequestDto,
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
    const payoutAmountBs = Number(withdrawalRequest.soles);

    if (status === WithdrawalStatus.REJECTED) {
      if (!rejectionReason?.trim()) {
        throw new BadRequestException('Debes proporcionar un motivo para rechazar la solicitud.');
      }
      const normalizedRejectionReason = rejectionReason.trim();

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
            description: JSON.stringify({
              event: 'WITHDRAWAL_REJECTION_REFUND',
              withdrawalRequestId: id,
              reason: rejectionReason.trim(),
              credits,
              payoutAmountBs,
            }),
          },
        });

        return tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: WithdrawalStatus.REJECTED,
            rejectionReason: normalizedRejectionReason,
            notes: notes?.trim() || null,
          },
        });
      });

      if (withdrawalRequest.wallet.user.email && withdrawalRequest.wallet.user.firstName) {
        this.mailService.sendWithdrawalRequestNotification(
          withdrawalRequest.wallet.user.email,
          withdrawalRequest.wallet.user.firstName,
          'REJECTED',
          credits,
          payoutAmountBs,
          normalizedRejectionReason,
        );
      }

      if (withdrawalRequest.wallet.user.fcmToken) {
        this.notificationsService.sendPushNotification(
          withdrawalRequest.wallet.user.fcmToken,
          'Solicitud de retiro rechazada',
          normalizedRejectionReason,
          { withdrawalRequestId: id, type: 'WITHDRAWAL_REJECTED' },
        );
      }

      return {
        ...updated,
        bankAccountId: updated.bankAccountId.toString(),
        amountBs: Number(updated.soles),
      };
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
            notes: notes?.trim() || null,
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
            description: JSON.stringify({
              event: 'WITHDRAWAL_APPROVAL',
              withdrawalRequestId: id,
              credits,
              payoutAmountBs,
            }),
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
          payoutAmountBs,
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
          amountBs: Number(result.soles),
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
