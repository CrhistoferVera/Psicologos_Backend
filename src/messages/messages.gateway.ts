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
  handleCallRequest(
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
    // Guardar sesión para facturación posterior
    this.callSessions.set(data.callId, {
      callerId: data.callerId,
      anfitrionaId: data.receiverId,
      callType: data.callType,
      startedAt: null,
    });

    this.server.to(`user_${data.receiverId}`).emit('incoming_call', data);
    client.emit('call_ringing', { callId: data.callId });
  }

  @SubscribeMessage('call_accepted')
  handleCallAccepted(
    @MessageBody() data: { callId: string; callerId: string },
    @ConnectedSocket() _client: Socket,
  ) {
    // Registrar inicio de la llamada para calcular duración después
    const session = this.callSessions.get(data.callId);
    if (session) session.startedAt = Date.now();

    this.server.to(`user_${data.callerId}`).emit('call_accepted', { callId: data.callId });
  }

  @SubscribeMessage('call_rejected')
  handleCallRejected(
    @MessageBody() data: { callId: string; callerId: string },
    @ConnectedSocket() _client: Socket,
  ) {
    this.callSessions.delete(data.callId);
    this.server.to(`user_${data.callerId}`).emit('call_rejected', { callId: data.callId });
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
      } catch (err) {
        console.error('[CallBilling] Error al facturar llamada:', err);
      }
    }
  }
}
