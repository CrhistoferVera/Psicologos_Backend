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
  anfitrionaId: string;
  callType: 'CALL' | 'VIDEO_CALL';
  startedAt: number | null;
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
    console.log(`Usuario ${userId} conectado`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: { senderId: string; receiverId: string; text: string; isLocked?: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const message = await this.messagesService.createMessage(
      data.senderId,
      data.receiverId,
      data.text,
      data.isLocked ?? false,
    );

    this.sendMessageToUser(data.receiverId, message);
    client.emit('message_sent', message);
  }

  sendMessageToUser(userId: string, message: any) {
    this.server.to(`user_${userId}`).emit('new_message', message);
  }

  // ── LLAMADAS ──────────────────────────────────────────────────────────────

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
      anfitrionaId: data.receiverId,
      callType: data.callType,
      startedAt: null,
    });

    this.server.to(`user_${data.receiverId}`).emit('incoming_call', data);
    client.emit('call_ringing', { callId: data.callId });

    // Push a la anfitriona por si tiene la app cerrada
    const anfitriona = await this.prisma.user.findUnique({
      where: { id: data.receiverId },
      select: { fcmToken: true },
    });
    if (anfitriona?.fcmToken) {
      const label = data.callType === 'VIDEO_CALL' ? 'Video llamada' : 'Llamada de voz';
      this.notificationsService.sendPushNotification(
        anfitriona.fcmToken,
        `📞 ${label} entrante`,
        `${data.callerName} te está llamando`,
        { callId: data.callId, callerId: data.callerId, type: 'INCOMING_CALL' }
      );
    }
  }

  @SubscribeMessage('call_accepted')
  async handleCallAccepted(
    @MessageBody() data: { callId: string; callerId: string; anfitrionaName: string },
    @ConnectedSocket() _client: Socket,
  ) {
    const session = this.callSessions.get(data.callId);
    if (session) session.startedAt = Date.now();

    this.server.to(`user_${data.callerId}`).emit('call_accepted', { callId: data.callId });

    // Push al cliente
    const caller = await this.prisma.user.findUnique({
      where: { id: data.callerId },
      select: { fcmToken: true },
    });
    if (caller?.fcmToken) {
      this.notificationsService.sendPushNotification(
        caller.fcmToken,
        '✅ Llamada aceptada',
        `${data.anfitrionaName} aceptó tu llamada`,
        { callId: data.callId, type: 'CALL_ACCEPTED' }
      );
    }
  }

  @SubscribeMessage('call_rejected')
  async handleCallRejected(
    @MessageBody() data: { callId: string; callerId: string; anfitrionaName: string },
    @ConnectedSocket() _client: Socket,
  ) {
    this.callSessions.delete(data.callId);
    this.server.to(`user_${data.callerId}`).emit('call_rejected', { callId: data.callId });

    // Push al cliente
    const caller = await this.prisma.user.findUnique({
      where: { id: data.callerId },
      select: { fcmToken: true },
    });
    if (caller?.fcmToken) {
      this.notificationsService.sendPushNotification(
        caller.fcmToken, 
        '❌ Llamada rechazada',
        `${data.anfitrionaName} no está disponible`,
        { callId: data.callId, type: 'CALL_REJECTED' }
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

    // Notificar al otro lado que la llamada terminó
    this.server.to(`user_${data.otherUserId}`).emit('call_ended', { callId: data.callId });

    // Facturar si la llamada efectivamente conectó
    if (session?.startedAt) {
      const durationSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
      try {
        const billing = await this.callsService.billCall(
          session.callerId,
          session.anfitrionaId,
          session.callType,
          durationSeconds,
        );
        // Notificar resultado de facturación a ambos lados
        const billingResult = { ...billing, durationSeconds };
        this.server.to(`user_${session.callerId}`).emit('call_billed', billingResult);
        this.server.to(`user_${session.anfitrionaId}`).emit('call_billed', billingResult);

        // Push a ambos con el resultado de facturación
        const [caller, anfitriona] = await Promise.all([
          this.prisma.user.findUnique({ where: { id: session.callerId }, select: { fcmToken: true } }),
          this.prisma.user.findUnique({ where: { id: session.anfitrionaId }, select: { fcmToken: true } }),
        ]);

        const billingMsg = `${billing.minutesBilled} min · ${billing.creditsCharged} créditos`;

        if (caller?.fcmToken) {
          this.notificationsService.sendPushNotification(
            caller.fcmToken,
            '💰 Llamada finalizada',
            `Se cobraron ${billing.creditsCharged} créditos · ${billing.minutesBilled} min`,
            { callId: data.callId, type: 'CALL_BILLED', ...billingResult }
          );
        }
        if (anfitriona?.fcmToken) {
          this.notificationsService.sendPushNotification(
            anfitriona.fcmToken,
            '💰 Llamada finalizada',
            `Ganaste ${billing.creditsCharged} créditos · ${billing.minutesBilled} min`,
            { callId: data.callId, type: 'CALL_BILLED', ...billingResult }
          );
        }
      } catch (err) {
        console.error('[CallBilling] Error al facturar llamada:', err);
      }
    }
  }
}
