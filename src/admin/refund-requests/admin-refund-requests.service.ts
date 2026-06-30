import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ResolveRefundAction, ResolveRefundDto } from './dto/resolve-refund.dto';

@Injectable()
export class AdminRefundRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(status?: RefundStatus, page = 1, limit = 20) {
    const where = status ? { status } : {};
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.refundRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
        include: {
          client: {
            select: { id: true, firstName: true, lastName: true, phoneNumber: true },
          },
          clientPayoutAccount: true,
          booking: {
            select: {
              id: true,
              scheduledStartAt: true,
              currency: true,
              priceBob: true,
              priceUsd: true,
              professional: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      this.prisma.refundRequest.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const request = await this.prisma.refundRequest.findUnique({
      where: { id },
      include: {
        client: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true, fcmToken: true },
        },
        clientPayoutAccount: true,
        booking: {
          select: {
            id: true,
            scheduledStartAt: true,
            currency: true,
            priceBob: true,
            priceUsd: true,
            noShowType: true,
            professional: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!request) throw new NotFoundException('Solicitud de reembolso no encontrada.');
    return request;
  }

  async resolve(id: string, dto: ResolveRefundDto, receiptFile?: Express.Multer.File) {
    const request = await this.prisma.refundRequest.findUnique({
      where: { id },
      include: {
        client: { select: { fcmToken: true, firstName: true } },
      },
    });

    if (!request) throw new NotFoundException('Solicitud de reembolso no encontrada.');

    if (request.status !== RefundStatus.PENDING) {
      throw new BadRequestException(`La solicitud ya fue procesada (estado: ${request.status}).`);
    }

    if (dto.action === ResolveRefundAction.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('Se requiere rejectionReason para rechazar una solicitud.');
    }

    let receiptUrl: string | null = null;
    let receiptPublicId: string | null = null;

    if (dto.action === ResolveRefundAction.PAID && receiptFile) {
      const uploaded = await this.cloudinary.uploadRefundReceipt({
        file: receiptFile,
        refundRequestId: id,
      });
      receiptUrl = uploaded.secureUrl;
      receiptPublicId = uploaded.publicId;
    }

    const newStatus = dto.action === ResolveRefundAction.PAID
      ? RefundStatus.PAID
      : RefundStatus.REJECTED;

    const updated = await this.prisma.refundRequest.update({
      where: { id },
      data: {
        status: newStatus,
        resolvedAt: new Date(),
        ...(receiptUrl ? { receiptUrl, receiptPublicId } : {}),
        ...(dto.rejectionReason ? { rejectionReason: dto.rejectionReason } : {}),
      },
    });

    // Notificar al cliente
    const fcmToken = request.client?.fcmToken;
    if (fcmToken) {
      if (newStatus === RefundStatus.PAID) {
        this.notifications.sendPushNotification(
          fcmToken,
          'Reembolso procesado',
          'Tu reembolso ha sido enviado. Revisa tu cuenta de pago.',
          { type: 'REFUND_PAID', refundRequestId: id },
        ).catch(() => {});
      } else {
        this.notifications.sendPushNotification(
          fcmToken,
          'Solicitud de reembolso rechazada',
          dto.rejectionReason ?? 'Tu solicitud de reembolso fue rechazada.',
          { type: 'REFUND_REJECTED', refundRequestId: id },
        ).catch(() => {});
      }
    }

    return updated;
  }
}
