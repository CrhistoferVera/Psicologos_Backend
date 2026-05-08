import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import { BookingsService } from '../bookings/bookings.service';

interface CallSession {
  callerId: string;
  professionalId: string;
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
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
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
    try {
      const message = await this.messagesService.createMessage(
        data.senderId,
        data.receiverId,
        data.text,
        false,
      );

      this.sendMessageToUser(data.receiverId, message);
      client.emit('message_sent', message);
    } catch (error: any) {
      client.emit('message_error', {
        message: error?.message ?? 'Solo puedes enviar mensajes durante una sesion activa.',
      });
    }
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
    try {
      await this.bookingsService.assertActiveBookingAccess(data.callerId, data.receiverId, 'CALL');

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
    } catch (error: any) {
      client.emit('call_error', {
        message: error?.message ?? 'Solo puedes iniciar llamadas durante una sesion activa.',
      });
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
    if (!session) return;

    try {
      await this.bookingsService.assertActiveBookingAccess(session.callerId, session.professionalId, 'CALL');
    } catch (error: any) {
      this.callSessions.delete(data.callId);
      this.server.to(`user_${session.callerId}`).emit('call_error', {
        callId: data.callId,
        message: error?.message ?? 'Solo puedes iniciar llamadas durante una sesion activa.',
      });
      this.server.to(`user_${session.professionalId}`).emit('call_error', {
        callId: data.callId,
        message: error?.message ?? 'Solo puedes iniciar llamadas durante una sesion activa.',
      });
      return;
    }

    session.startedAt = Date.now();

    this.server.to(`user_${data.callerId}`).emit('call_accepted', { callId: data.callId });

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

    if (session) {
      this.server.to(`user_${session.callerId}`).emit('call_ended', { callId: data.callId });
      this.server.to(`user_${session.professionalId}`).emit('call_ended', { callId: data.callId });
    } else {
      this.server.to(`user_${data.otherUserId}`).emit('call_ended', { callId: data.callId });
    }

    if (session?.startedAt) {
      const durationSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
      const [caller, professional] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: session.callerId }, select: { fcmToken: true } }),
        this.prisma.user.findUnique({ where: { id: session.professionalId }, select: { fcmToken: true } }),
      ]);

      const minutes = Math.ceil(durationSeconds / 60);
      if (caller?.fcmToken) {
        this.notificationsService.sendPushNotification(
          caller.fcmToken,
          'Llamada finalizada',
          `Duración: ${minutes} min`,
          { callId: data.callId, type: 'CALL_ENDED', durationSeconds },
        );
      }
      if (professional?.fcmToken) {
        this.notificationsService.sendPushNotification(
          professional.fcmToken,
          'Llamada finalizada',
          `Duración: ${minutes} min`,
          { callId: data.callId, type: 'CALL_ENDED', durationSeconds },
        );
      }
    }
  }
}
