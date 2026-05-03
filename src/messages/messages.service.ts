import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
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

