import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';
import { CallsService } from '../calls/calls.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';

interface CallSession {
  callerId: string;
  professionalId: string;
  callType: 'CALL' | 'VIDEO_CALL';
  startedAt: number | null;
  warningInterval?: NodeJS.Timeout;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessagesGateway {
  @WebSocketServer()
  server: Server;

  private readonly callSessions = new Map<string, CallSession>();

  constructor(
    private readonly messagesService: MessagesService,
    private readonly callsService: CallsService,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() userId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`user_${userId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: { senderId: string; receiverId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const message = await this.messagesService.createMessage(
      data.senderId,
      data.receiverId,
      data.text,
      false,
    );

    this.sendMessageToUser(data.receiverId, message);
    client.emit('message_sent', message);
  }

  sendMessageToUser(userId: string, message: any) {
    this.server.to(`user_${userId}`).emit('new_message', message);
  }

  @SubscribeMessage('call_request')
  async handleCallRequest(
    @MessageBody()
    data: {
      callId: string;
      callerId: string;
      receiverId: string;
      callType: 'CALL' | 'VIDEO_CALL';
      callerName: string;
      callerAvatar: string | null;
      pricePerMinute: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    this.callSessions.set(data.callId, {
      callerId: data.callerId,
      professionalId: data.receiverId,
      callType: data.callType,
      startedAt: null,
    });

    this.server.to(`user_${data.receiverId}`).emit('incoming_call', data);
    client.emit('call_ringing', { callId: data.callId });

    const professional = await this.prisma.user.findUnique({
      where: { id: data.receiverId },
      select: { fcmToken: true },
    });
    if (professional?.fcmToken) {
      const label = data.callType === 'VIDEO_CALL' ? 'Video llamada' : 'Llamada de voz';
      this.notificationsService.sendPushNotification(
        professional.fcmToken,
        `📞 ${label} entrante`,
        `${data.callerName} te esta llamando`,
        { callId: data.callId, callerId: data.callerId, type: 'INCOMING_CALL' },
      );
    }
  }

  @SubscribeMessage('call_accepted')
  async handleCallAccepted(
    @MessageBody()
    data: {
      callId: string;
      callerId: string;
      professionalName?: string;
      // Deprecated legacy alias kept for backwards compatibility with old clients.
      anfitrionaName?: string;
    },
    @ConnectedSocket() _client: Socket,
  ) {
    const session = this.callSessions.get(data.callId);
    if (session) session.startedAt = Date.now();

    this.server.to(`user_${data.callerId}`).emit('call_accepted', { callId: data.callId });

    if (session) {
      session.warningInterval = setInterval(async () => {
        const caller = await this.prisma.user.findUnique({
          where: { id: session.callerId },
          select: { fcmToken: true, wallet: { select: { balance: true } } },
        });

        if (caller?.fcmToken && caller.wallet) {
          const balance = Number(caller.wallet.balance);
          this.notificationsService.sendPushNotification(
            caller.fcmToken,
            'Llamada en curso',
            `Te quedan ${balance} creditos`,
            { callId: data.callId, type: 'CALL_WARNING', balance },
          );
        }
      }, 2 * 60 * 1000);
    }

    const caller = await this.prisma.user.findUnique({
      where: { id: data.callerId },
      select: { fcmToken: true },
    });
    if (caller?.fcmToken) {
      const professionalName = data.professionalName ?? data.anfitrionaName ?? 'El profesional';
      this.notificationsService.sendPushNotification(
        caller.fcmToken,
        'Llamada aceptada',
        `${professionalName} acepto tu llamada`,
        { callId: data.callId, type: 'CALL_ACCEPTED' },
      );
    }
  }

  @SubscribeMessage('call_rejected')
  async handleCallRejected(
    @MessageBody()
    data: {
      callId: string;
      callerId: string;
      professionalName?: string;
      // Deprecated legacy alias kept for backwards compatibility with old clients.
      anfitrionaName?: string;
    },
    @ConnectedSocket() _client: Socket,
  ) {
    const session = this.callSessions.get(data.callId);
    if (session?.warningInterval) clearInterval(session.warningInterval);
    this.callSessions.delete(data.callId);
    this.server.to(`user_${data.callerId}`).emit('call_rejected', { callId: data.callId });

    const caller = await this.prisma.user.findUnique({
      where: { id: data.callerId },
      select: { fcmToken: true },
    });
    if (caller?.fcmToken) {
      const professionalName = data.professionalName ?? data.anfitrionaName ?? 'El profesional';
      this.notificationsService.sendPushNotification(
        caller.fcmToken,
        'Llamada rechazada',
        `${professionalName} no esta disponible`,
        { callId: data.callId, type: 'CALL_REJECTED' },
      );
    }
  }

  @SubscribeMessage('call_ended')
  async handleCallEnded(
    @MessageBody() data: { callId: string; otherUserId: string },
    @ConnectedSocket() _client: Socket,
  ) {
    const session = this.callSessions.get(data.callId);
    this.callSessions.delete(data.callId);

    if (session?.warningInterval) clearInterval(session.warningInterval);

    if (session) {
      this.server.to(`user_${session.callerId}`).emit('call_ended', { callId: data.callId });
      this.server.to(`user_${session.professionalId}`).emit('call_ended', { callId: data.callId });
    } else {
      this.server.to(`user_${data.otherUserId}`).emit('call_ended', { callId: data.callId });
    }

    if (session?.startedAt) {
      const durationSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
      try {
        const billing = await this.callsService.billCall(
          session.callerId,
          session.professionalId,
          session.callType,
          durationSeconds,
        );

        const billingResult = { ...billing, durationSeconds };
        this.server.to(`user_${session.callerId}`).emit('call_billed', billingResult);
        this.server.to(`user_${session.professionalId}`).emit('call_billed', billingResult);

        const [caller, professional] = await Promise.all([
          this.prisma.user.findUnique({ where: { id: session.callerId }, select: { fcmToken: true } }),
          this.prisma.user.findUnique({ where: { id: session.professionalId }, select: { fcmToken: true } }),
        ]);

        if (caller?.fcmToken) {
          this.notificationsService.sendPushNotification(
            caller.fcmToken,
            'Llamada finalizada',
            `Se cobraron ${billing.creditsCharged} creditos · ${billing.minutesBilled} min`,
            { callId: data.callId, type: 'CALL_BILLED', ...billingResult },
          );
        }
        if (professional?.fcmToken) {
          this.notificationsService.sendPushNotification(
            professional.fcmToken,
            'Llamada finalizada',
            `Ganaste ${billing.realCreditsCharged} creditos reales · ${billing.minutesBilled} min`,
            { callId: data.callId, type: 'CALL_BILLED', ...billingResult },
          );
        }
      } catch (err) {
        console.error('[CallBilling] Error al facturar llamada:', err);
      }
    }
  }
}
