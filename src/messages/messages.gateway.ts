import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { PROFESSIONAL_ROLES } from '../common/professional-role';

interface CallSession {
  callerId: string;
  professionalId: string;
  callType: 'CALL' | 'VIDEO_CALL';
  startedAt: number | null;
}

type RegisteredSocketUser = {
  userId: string;
  role: UserRole;
};

type RegisterPayload =
  | string
  | {
      userId?: string;
      token?: string;
    };

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessagesGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly callSessions = new Map<string, CallSession>();
  private readonly socketUsers = new Map<string, RegisteredSocketUser>();

  constructor(
    private readonly messagesService: MessagesService,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly jwtService: JwtService,
  ) {}

  handleDisconnect(client: Socket) {
    this.socketUsers.delete(client.id);
  }

  private getBearerToken(rawValue: unknown): string | null {
    if (Array.isArray(rawValue)) {
      return this.getBearerToken(rawValue[0]);
    }
    if (typeof rawValue !== 'string') return null;
    const value = rawValue.trim();
    if (!value) return null;
    if (value.toLowerCase().startsWith('bearer ')) {
      const token = value.slice(7).trim();
      return token || null;
    }
    return value;
  }

  private getTokenFromSocket(client: Socket, payload?: RegisterPayload): string | null {
    const handshakeAuthToken = this.getBearerToken(client.handshake.auth?.token);
    if (handshakeAuthToken) return handshakeAuthToken;

    const headerToken = this.getBearerToken(client.handshake.headers?.authorization);
    if (headerToken) return headerToken;

    const queryToken = this.getBearerToken(client.handshake.query?.token);
    if (queryToken) return queryToken;

    if (payload && typeof payload !== 'string') {
      const payloadToken = this.getBearerToken(payload.token);
      if (payloadToken) return payloadToken;
    }

    return null;
  }

  private async resolveSocketUser(
    client: Socket,
    payload?: RegisterPayload,
  ): Promise<RegisteredSocketUser | null> {
    const cached = this.socketUsers.get(client.id);
    if (cached) return cached;

    const token = this.getTokenFromSocket(client, payload);
    if (!token) return null;

    try {
      const jwtPayload = await this.jwtService.verifyAsync<{ sub?: string; role?: UserRole }>(token);
      if (!jwtPayload?.sub || !jwtPayload.role) return null;

      const user = await this.prisma.user.findUnique({
        where: { id: jwtPayload.sub },
        select: { id: true, role: true, isActive: true },
      });
      if (!user || !user.isActive) return null;

      const resolved: RegisteredSocketUser = { userId: user.id, role: user.role };
      this.socketUsers.set(client.id, resolved);
      return resolved;
    } catch {
      return null;
    }
  }

  private async getRequiredSocketUser(
    client: Socket,
    payload?: RegisterPayload,
  ): Promise<RegisteredSocketUser | null> {
    const socketUser = await this.resolveSocketUser(client, payload);
    if (!socketUser) {
      client.emit('auth_error', {
        message: 'Sesion invalida para socket. Inicia sesion nuevamente.',
      });
      return null;
    }
    return socketUser;
  }

  @SubscribeMessage('register')
  async handleRegister(
    @MessageBody() payload: RegisterPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const socketUser = await this.resolveSocketUser(client, payload);
    if (!socketUser) {
      client.emit('register_error', {
        message: 'No se pudo autenticar el socket.',
      });
      return;
    }

    client.join(`user_${socketUser.userId}`);
    client.emit('registered', { userId: socketUser.userId });
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: { receiverId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const socketUser = await this.getRequiredSocketUser(client);
    if (!socketUser) return;

    if (!data?.receiverId) {
      client.emit('message_error', {
        message: 'No se encontro el destinatario del mensaje.',
      });
      return;
    }

    try {
      const message = await this.messagesService.createMessage(
        socketUser.userId,
        data.receiverId,
        data.text,
        false,
      );

      this.sendMessageToUser(data.receiverId, message);
      client.emit('message_sent', message);
    } catch (error: any) {
      client.emit('message_error', {
        message: error?.message ?? 'Los mensajes estan disponibles solo durante una sesion activa.',
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
      callerId?: string;
      receiverId: string;
      callType: 'CALL' | 'VIDEO_CALL';
      callerName?: string;
      callerAvatar?: string | null;
      pricePerMinute?: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const socketUser = await this.getRequiredSocketUser(client);
    if (!socketUser) return;

    if (!data?.callId || !data?.receiverId || !data?.callType) {
      client.emit('call_error', {
        message: 'Datos de llamada incompletos.',
      });
      return;
    }

    if (socketUser.role !== UserRole.USER) {
      client.emit('call_error', {
        message: 'Solo el cliente puede iniciar la llamada durante la sesion activa.',
      });
      return;
    }

    if (data.receiverId === socketUser.userId) {
      client.emit('call_error', {
        message: 'No puedes iniciar una llamada contigo mismo.',
      });
      return;
    }

    try {
      const receiver = await this.prisma.user.findUnique({
        where: { id: data.receiverId },
        select: { id: true, role: true, fcmToken: true, isActive: true },
      });
      if (!receiver || !receiver.isActive || !PROFESSIONAL_ROLES.includes(receiver.role)) {
        client.emit('call_error', {
          message: 'Solo puedes llamar a profesionales disponibles.',
        });
        return;
      }

      await this.bookingsService.assertActiveBookingAccess(socketUser.userId, receiver.id, 'CALL');

      const caller = await this.prisma.user.findUnique({
        where: { id: socketUser.userId },
        select: { firstName: true, lastName: true, email: true },
      });
      const callerName = `${caller?.firstName ?? ''} ${caller?.lastName ?? ''}`.trim() || caller?.email || 'Cliente';

      this.callSessions.set(data.callId, {
        callerId: socketUser.userId,
        professionalId: receiver.id,
        callType: data.callType,
        startedAt: null,
      });

      this.server.to(`user_${receiver.id}`).emit('incoming_call', {
        callId: data.callId,
        callerId: socketUser.userId,
        receiverId: receiver.id,
        callType: data.callType,
        callerName,
        callerAvatar: null,
      });
      client.emit('call_ringing', { callId: data.callId });

      if (receiver.fcmToken) {
        const label = data.callType === 'VIDEO_CALL' ? 'Video llamada' : 'Llamada de voz';
        this.notificationsService.sendPushNotification(
          receiver.fcmToken,
          `${label} entrante`,
          `${callerName} te esta llamando`,
          {
            callId: data.callId,
            callerId: socketUser.userId,
            receiverId: receiver.id,
            callType: data.callType,
            callerName,
            type: 'INCOMING_CALL',
          },
        );
      }
    } catch (error: any) {
      client.emit('call_error', {
        message: error?.message ?? 'Las llamadas estan disponibles solo durante una sesion activa.',
      });
    }
  }

  @SubscribeMessage('call_accepted')
  async handleCallAccepted(
    @MessageBody()
    data: {
      callId: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const socketUser = await this.getRequiredSocketUser(client);
    if (!socketUser) return;

    const session = this.callSessions.get(data.callId);
    if (!session) return;

    if (socketUser.userId !== session.professionalId) {
      client.emit('call_error', {
        callId: data.callId,
        message: 'Solo el profesional receptor puede aceptar esta llamada.',
      });
      return;
    }

    try {
      await this.bookingsService.assertActiveBookingAccess(session.callerId, session.professionalId, 'CALL');
    } catch (error: any) {
      this.callSessions.delete(data.callId);
      this.server.to(`user_${session.callerId}`).emit('call_error', {
        callId: data.callId,
        message: error?.message ?? 'Las llamadas estan disponibles solo durante una sesion activa.',
      });
      this.server.to(`user_${session.professionalId}`).emit('call_error', {
        callId: data.callId,
        message: error?.message ?? 'Las llamadas estan disponibles solo durante una sesion activa.',
      });
      return;
    }

    session.startedAt = Date.now();

    this.server.to(`user_${session.callerId}`).emit('call_accepted', { callId: data.callId });

    const [caller, professional] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: session.callerId },
        select: { fcmToken: true },
      }),
      this.prisma.user.findUnique({
        where: { id: session.professionalId },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);
    if (caller?.fcmToken) {
      const professionalName =
        `${professional?.firstName ?? ''} ${professional?.lastName ?? ''}`.trim() ||
        professional?.email ||
        'El profesional';
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
    },
    @ConnectedSocket() client: Socket,
  ) {
    const socketUser = await this.getRequiredSocketUser(client);
    if (!socketUser) return;

    const session = this.callSessions.get(data.callId);
    if (!session) return;

    if (socketUser.userId !== session.professionalId) {
      client.emit('call_error', {
        callId: data.callId,
        message: 'Solo el profesional receptor puede rechazar esta llamada.',
      });
      return;
    }

    this.callSessions.delete(data.callId);
    this.server.to(`user_${session.callerId}`).emit('call_rejected', { callId: data.callId });

    const [caller, professional] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: session.callerId },
        select: { fcmToken: true },
      }),
      this.prisma.user.findUnique({
        where: { id: session.professionalId },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);
    if (caller?.fcmToken) {
      const professionalName =
        `${professional?.firstName ?? ''} ${professional?.lastName ?? ''}`.trim() ||
        professional?.email ||
        'El profesional';
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
    @MessageBody() data: { callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const socketUser = await this.getRequiredSocketUser(client);
    if (!socketUser) return;

    const session = this.callSessions.get(data.callId);
    if (
      session &&
      socketUser.userId !== session.callerId &&
      socketUser.userId !== session.professionalId
    ) {
      client.emit('call_error', {
        callId: data.callId,
        message: 'No tienes permiso para finalizar esta llamada.',
      });
      return;
    }

    this.callSessions.delete(data.callId);

    if (!session) {
      // Idempotencia: si la llamada ya fue limpiada, no es un error funcional.
      return;
    }

    this.server.to(`user_${session.callerId}`).emit('call_ended', { callId: data.callId });
    this.server.to(`user_${session.professionalId}`).emit('call_ended', { callId: data.callId });

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
          `Duracion: ${minutes} min`,
          { callId: data.callId, type: 'CALL_ENDED', durationSeconds },
        );
      }
      if (professional?.fcmToken) {
        this.notificationsService.sendPushNotification(
          professional.fcmToken,
          'Llamada finalizada',
          `Duracion: ${minutes} min`,
          { callId: data.callId, type: 'CALL_ENDED', durationSeconds },
        );
      }
    }
  }
}
