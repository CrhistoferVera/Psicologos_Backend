import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, ServiceType, TransactionType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ServicePricesService } from '../service-prices/service-prices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { allocateCreditDebit } from '../wallet/utils/credit-allocation.util';
import { SystemConfigService } from '../system-config/system-config.service';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly servicePricesService: ServicePricesService,
    private readonly notificationsService: NotificationsService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private ttlCutoff(): Date {
    const hours = Number(process.env.MESSAGE_TTL_HOURS ?? 24);
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async deleteExpiredMessages() {
    const cutoff = this.ttlCutoff();
    const result = await this.prisma.message.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (result.count > 0) {
      this.logger.log(`Eliminados ${result.count} mensajes expirados`);
    }
  }

  async createMessage(
    senderId: string,
    receiverId: string,
    text: string,
    _legacyLockedFlag = false,
  ) {
    const messageText = text?.trim();
    if (!messageText) {
      throw new BadRequestException('El mensaje no puede estar vacio.');
    }

    const [user1Id, user2Id] = [senderId, receiverId].sort();

    const conversation = await this.prisma.conversation.upsert({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      create: { user1Id, user2Id },
      update: {},
    });

    const senderProfile = await this.prisma.professionalProfile.findUnique({
      where: { userId: senderId },
      select: { id: true },
    });

    if (!senderProfile) {
      const sendPrice = await this.servicePricesService.getPriceForUser(
        receiverId,
        ServiceType.MESSAGE_SEND,
      );

      if (sendPrice && sendPrice.price > 0) {
        const creditsRequired = sendPrice.price;

        const clientWallet = await this.prisma.wallet.findUnique({ where: { userId: senderId } });
        if (!clientWallet) throw new NotFoundException('Wallet del cliente no encontrada');
        if (Number(clientWallet.balance) < creditsRequired) {
          throw new BadRequestException('Creditos insuficientes para enviar el mensaje');
        }

        const professionalWallet = await this.prisma.wallet.findUnique({ where: { userId: receiverId } });
        if (!professionalWallet) throw new NotFoundException('Wallet de profesional no encontrada');

        const [client, runtimeConfig, adminWallet] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: senderId },
            select: { firstName: true, lastName: true },
          }),
          this.systemConfigService.getRuntimeConfig(),
          this.prisma.wallet.findFirst({
            where: { user: { role: UserRole.ADMIN } },
            select: { id: true, userId: true },
          }),
        ]);

        const clientName = [client?.firstName, client?.lastName].filter(Boolean).join(' ') || 'Cliente';

        const debit = allocateCreditDebit(
          Number(clientWallet.balance),
          Number(clientWallet.promotionalBalance),
          creditsRequired,
        );

        const feePct = runtimeConfig.platformFeePercent / 100;
        const distributableCredits = debit.realDebited;
        const adminShare = Math.round(distributableCredits * feePct * 100) / 100;
        const professionalShare = Math.round((distributableCredits - adminShare) * 100) / 100;

        const clientWalletUpdate: Prisma.WalletUpdateInput = {
          balance: { decrement: debit.totalDebited },
        };
        if (debit.promotionalDebited > 0) {
          clientWalletUpdate.promotionalBalance = { decrement: debit.promotionalDebited };
        }

        const operations: Prisma.PrismaPromise<unknown>[] = [
          this.prisma.wallet.update({
            where: { userId: senderId },
            data: clientWalletUpdate,
          }),
          this.prisma.transaction.create({
            data: {
              walletId: clientWallet.id,
              type: TransactionType.MESSAGE_SEND,
              amount: debit.totalDebited,
              promotionalAmount: debit.promotionalDebited,
              realAmount: debit.realDebited,
              isPromotional: debit.realDebited === 0,
              description: 'Costo por enviar mensaje',
            },
          }),
        ];

        if (professionalShare > 0) {
          operations.push(
            this.prisma.wallet.update({
              where: { userId: receiverId },
              data: { balance: { increment: professionalShare } },
            }),
            this.prisma.transaction.create({
              data: {
                walletId: professionalWallet.id,
                type: TransactionType.EARNING,
                amount: professionalShare,
                promotionalAmount: 0,
                realAmount: professionalShare,
                isPromotional: false,
                description: JSON.stringify({ service: 'Mensaje recibido', clientName }),
              },
            }),
          );
        }

        if (adminWallet && adminShare > 0) {
          operations.push(
            this.prisma.wallet.update({
              where: { id: adminWallet.id },
              data: { balance: { increment: adminShare } },
            }),
            this.prisma.transaction.create({
              data: {
                walletId: adminWallet.id,
                type: TransactionType.EARNING,
                amount: adminShare,
                promotionalAmount: 0,
                realAmount: adminShare,
                isPromotional: false,
                description: JSON.stringify({ service: 'Comision mensaje', clientName }),
              },
            }),
          );
        }

        await this.prisma.$transaction(operations);
      }
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        text: messageText,
      },
    });

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { fcmToken: true },
    });

    if (receiver?.fcmToken) {
      this.notificationsService.sendPushNotification(
        receiver.fcmToken,
        'Nuevo mensaje',
        'Tienes un nuevo mensaje',
        { conversationId: conversation.id, type: 'NEW_MESSAGE' },
      );
    }

    return { ...message, conversationId: conversation.id };
  }

  async getMessages(conversationId: string, _requestingUserId: string) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId, createdAt: { gte: this.ttlCutoff() } },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((msg) => ({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      text: msg.text,
      read: msg.read,
      createdAt: msg.createdAt,
    }));
  }

  async getChats(userId: string) {
    const cutoff = this.ttlCutoff();

    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        messages: {
          where: { createdAt: { gte: cutoff } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        user1: {
          select: {
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
        user2: {
          select: {
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const chats = await Promise.all(
      conversations.map(async (conv) => {
        const isUser1 = conv.user1Id === userId;
        const otherUserId = isUser1 ? conv.user2Id : conv.user1Id;
        const otherUser = isUser1 ? conv.user2 : conv.user1;
        const lastMessage = conv.messages[0] ?? null;

        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conv.id,
            read: false,
            senderId: { not: userId },
            createdAt: { gte: cutoff },
          },
        });

        const fullName = [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ');
        const otherUserName = otherUser.professionalProfile?.username ?? (fullName || 'Usuario');

        return {
          conversationId: conv.id,
          otherUserId,
          otherUserName,
          otherUserAvatar: otherUser.professionalProfile?.avatarUrl ?? null,
          lastMessage: lastMessage?.text ?? null,
          lastMessageAt: lastMessage?.createdAt ?? conv.createdAt,
          unreadCount,
        };
      }),
    );

    return chats.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });
  }

  async markAsRead(conversationId: string, userId: string) {
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        read: false,
      },
      data: { read: true },
    });

    return { success: true };
  }
}

