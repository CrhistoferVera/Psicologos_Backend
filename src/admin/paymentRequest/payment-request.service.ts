import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WithdrawalStatus, Prisma, TransactionType } from '@prisma/client';
import { UpdateWithdrawalRequetsDto } from './dto/update-withdrawalRequest.dto';
import { MailService } from 'src/mail/mail.service';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class RechargeRequestService {
    constructor(
        private prisma: PrismaService,
        private mailService: MailService,
        private notificationsService: NotificationsService,
    ) { }

    async updateDepositStatus(
        id: string,
        updateDto: UpdateWithdrawalRequetsDto,
        receiptData?: { url: string; publicId: string }
    ) {
        const { status, rejectionReason } = updateDto;

        const withdrawalRequest = await this.prisma.withdrawalRequest.findUnique({
            where: { id },
            include: {
                wallet: {
                    include: {
                        user: {
                            select: { email: true, firstName: true, fcmToken: true }
                        }
                    }
                }
            }
        });

        if (!withdrawalRequest) {
            throw new NotFoundException('La solicitud no existe.');
        }

        if (withdrawalRequest.status !== WithdrawalStatus.PENDING) {
            throw new BadRequestException(`Esta solicitud ya fue procesada con estado: ${withdrawalRequest.status}`);
        }

        const credits = Number(withdrawalRequest.credits);

        // RECHAZO — devuelve los créditos a la wallet
        if (status === WithdrawalStatus.REJECTED) {
            const updated = await this.prisma.$transaction(async (tx) => {
                // Devolver créditos
                await tx.wallet.update({
                    where: { id: withdrawalRequest.walletId },
                    data: { balance: { increment: credits } }
                });

                // Registrar transacción de devolución
                await tx.transaction.create({
                    data: {
                        walletId: withdrawalRequest.walletId,
                        amount: new Prisma.Decimal(credits),
                        type: TransactionType.WITHDRAWAL,
                        description: `Devolución por retiro rechazado`
                    }
                });

                // Actualizar estado
                return tx.withdrawalRequest.update({
                    where: { id },
                    data: { status: WithdrawalStatus.REJECTED, rejectionReason }
                });
            });

            if (withdrawalRequest.wallet.user.email && withdrawalRequest.wallet.user.firstName) {
                this.mailService.sendWithdrawalRequestNotification(
                    withdrawalRequest.wallet.user.email,
                    withdrawalRequest.wallet.user.firstName,
                    'REJECTED',
                    credits,
                    Number(withdrawalRequest.soles),
                    rejectionReason
                );
            }

            if (withdrawalRequest.wallet.user.fcmToken) {

                //esto se envia a firebase para que lo reciba la app móvil y muestre una notificación push al usuario informando que su solicitud de retiro fue rechazada.
                this.notificationsService.sendPushNotification(
                    withdrawalRequest.wallet.user.fcmToken,
                    '❌ Solicitud de retiro rechazada',
                    rejectionReason ?? 'Tu solicitud de retiro fue rechazada.',
                    { withdrawalRequestId: id, type: 'WITHDRAWAL_REJECTED' }
                );
            }

            return { ...updated, bankAccountId: updated.bankAccountId.toString() };
        }

        // APROBACIÓN — guarda comprobante del admin
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
                        receiptUrl: receiptData!.url,
                        receiptPublicId: receiptData!.publicId,
                    }
                });

                await tx.transaction.create({
                    data: {
                        walletId: withdrawalRequest.walletId,
                        amount: new Prisma.Decimal(credits),
                        type: TransactionType.WITHDRAWAL,
                        description: `Retiro aprobado`
                    }
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
                    null
                );
            }

            if (withdrawalRequest.wallet.user.fcmToken) {
                this.notificationsService.sendPushNotification(
                    withdrawalRequest.wallet.user.fcmToken,
                    '✅ Solicitud de retiro aprobada',
                    `Tu retiro de ${credits} créditos fue procesado exitosamente.`,
                    { withdrawalRequestId: id, type: 'WITHDRAWAL_APPROVED' }
                );
            }

            return { message: 'Retiro aprobado con éxito.', request: { ...result, bankAccountId: result.bankAccountId.toString() } };

        } catch (error) {
            console.error('Error en transacción de aprobación:', error);
            throw new InternalServerErrorException('No se pudo procesar la aprobación. Intente de nuevo.');
        }
    }
}
