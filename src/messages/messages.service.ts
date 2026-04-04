import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServiceType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { ServicePricesService } from '../service-prices/service-prices.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servicePricesService: ServicePricesService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async createMessage(
    senderId: string,
    receiverId: string,
    text: string,
    isLocked: boolean = false,
  ) {
    const [user1Id, user2Id] = [senderId, receiverId].sort();

    const conversation = await this.prisma.conversation.upsert({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      create: { user1Id, user2Id },
      update: {},
    });

    let price: number | null = null;

    if (isLocked) {
      const servicePrice = await this.servicePricesService.getPriceForUser(
        senderId,
        ServiceType.MESSAGE,
      );
      if (!servicePrice) {
        throw new BadRequestException(
          'Debes configurar un precio para mensajes antes de bloquearlos',
        );
      }
      price = servicePrice.price;
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        text,
        isLocked,
        price,
      },
    });

    // Obtener fcmToken del receptor para notificarle
    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { fcmToken: true },
    });

    if (receiver?.fcmToken) {
      if (isLocked) {
        // Notificar que hay un mensaje bloqueado (de pago)
        this.notificationsService.sendPushNotification(
          receiver.fcmToken,
          '🔒 Nuevo mensaje premium',
          'Tienes un mensaje bloqueado esperándote',
          { conversationId: conversation.id, type: 'NEW_LOCKED_MESSAGE' }
        );
      } else {
        // Notificar mensaje normal
        this.notificationsService.sendPushNotification(
          receiver.fcmToken,
          '💬 Nuevo mensaje',
          'Tienes un nuevo mensaje',
          { conversationId: conversation.id, type: 'NEW_MESSAGE' }
        );
      }
    }

    return { ...message, conversationId: conversation.id };
  }

  async getMessages(conversationId: string, requestingUserId: string) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        messageUnlocks: {
          where: { userId: requestingUserId },
          select: { id: true },
        },
      },
    });

    return messages.map((msg) => {
      const isUnlocked = msg.messageUnlocks.length > 0;
      const isSender = msg.senderId === requestingUserId;

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        // El emisor siempre ve su propio texto; el receptor solo si pagó o es gratis
        text: isSender || !msg.isLocked || isUnlocked ? msg.text : null,
        read: msg.read,
        isLocked: msg.isLocked,
        price: msg.price,
        isUnlocked,
        createdAt: msg.createdAt,
      };
    });
  }

  async unlockMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { firstName: true, lastName: true } },
      },
    });

    if (!message) throw new NotFoundException('Mensaje no encontrado');
    if (!message.isLocked) throw new BadRequestException('Este mensaje no está bloqueado');
    if (message.senderId === userId) throw new BadRequestException('No puedes desbloquear tu propio mensaje');

    const existing = await this.prisma.messageUnlock.findUnique({
      where: { messageId_userId: { messageId, userId } },
    });
    if (existing) throw new BadRequestException('Ya desbloqueaste este mensaje');

    const creditsRequired = message.price!;

    // Wallet del cliente que paga
    const clientWallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!clientWallet) throw new NotFoundException('Wallet no encontrada');
    if (Number(clientWallet.balance) < creditsRequired) {
      throw new BadRequestException('Créditos insuficientes');
    }

    // Wallet de la anfitriona que cobra
    const anfitrionaWallet = await this.prisma.wallet.findUnique({
      where: { userId: message.senderId },
    });
    if (!anfitrionaWallet) throw new NotFoundException('Wallet de anfitriona no encontrada');

    // Get client name for description
    const client = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const clientName = [client?.firstName, client?.lastName].filter(Boolean).join(' ') || 'Cliente';

    const adminUserId = this.config.get<string>('ADMIN_USER_ID');
    const feePct = Number(this.config.get<string>('PLATFORM_FEE_PERCENT') ?? '50') / 100;
    const total = Number(creditsRequired);
    const adminShare = Math.round(total * feePct * 100) / 100;
    const anfitrionaShare = Math.round((total - adminShare) * 100) / 100;

    const adminWallet = adminUserId
      ? await this.prisma.wallet.findUnique({ where: { userId: adminUserId } })
      : null;

    // Transacción atómica: débito al cliente + crédito a la anfitriona + comisión admin
    const [, clientTx] = await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId },
        data: { balance: { decrement: creditsRequired } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: 'MESSAGE_UNLOCK',
          amount: creditsRequired,
          description: `Desbloqueo de mensaje`,
        },
      }),
      this.prisma.wallet.update({
        where: { userId: message.senderId },
        data: { balance: { increment: anfitrionaShare } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: anfitrionaWallet.id,
          type: 'EARNING',
          amount: anfitrionaShare,
          description: JSON.stringify({ service: 'Mensaje Bloqueado', clientName }),
        },
      }),
      ...(adminWallet && adminShare > 0
        ? [
            this.prisma.wallet.update({
              where: { userId: adminUserId! },
              data: { balance: { increment: adminShare } },
            }),
            this.prisma.transaction.create({
              data: {
                walletId: adminWallet.id,
                type: 'EARNING',
                amount: adminShare,
                description: JSON.stringify({ service: 'Comisión Mensaje Bloqueado', clientName }),
              },
            }),
          ]
        : []),
    ]);

    await this.prisma.messageUnlock.create({
      data: {
        messageId,
        userId,
        creditsSpent: creditsRequired,
        transactionId: clientTx.id,
      },
    });

    // Notificar a la anfitriona que su mensaje fue desbloqueado
    const anfitriona = await this.prisma.user.findUnique({
      where: { id: message.senderId },
      select: { fcmToken: true },
    });

    if (anfitriona?.fcmToken) {
      this.notificationsService.sendPushNotification(
        anfitriona.fcmToken,
        '💰 Mensaje desbloqueado',
        `${clientName} desbloqueó tu mensaje`,
        { conversationId: message.conversationId, type: 'MESSAGE_UNLOCKED' }
      );
    }

    return { success: true, text: message.text };
  }

  async getChats(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        user1: {
          select: {
            firstName: true,
            lastName: true,
            anfitrionaProfile: { select: { avatarUrl: true, username: true } },
          },
        },
        user2: {
          select: {
            firstName: true,
            lastName: true,
            anfitrionaProfile: { select: { avatarUrl: true, username: true } },
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
          },
        });

        const fullName = [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ');
        const otherUserName = otherUser.anfitrionaProfile?.username ?? (fullName || 'Usuario');

        return {
          conversationId: conv.id,
          otherUserId,
          otherUserName,
          otherUserAvatar: otherUser.anfitrionaProfile?.avatarUrl ?? null,
          lastMessage: lastMessage?.isLocked ? '🔒 Mensaje bloqueado' : (lastMessage?.text ?? null),
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
