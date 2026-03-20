import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessagesGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly messagesService: MessagesService) {}
  
  //regitrar al usaurio para que peuda entrar a la sala 
  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() userId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`user_${userId}`);
    console.log(`Usuario ${userId} conectado`);
  }

  //cuando se manda el mensaje recive el evento send_message para conecetarlo al clinete , guarda el mensaje en bd y luego emite al receptor
  //osea lo manda al cliente y si todo sale sale bien confirma con otro evento llamado message sent 
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

    // Emite al receptor
    this.sendMessageToUser(data.receiverId, message);

    // Confirma al emisor
    client.emit('message_sent', message);
  }

  sendMessageToUser(userId: string, message: any) {
    this.server.to(`user_${userId}`).emit('new_message', message);
  }
  
}
