import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

interface JwtUser {
  userId: string;
}

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly gateway: MessagesGateway,
  ) {}

  // POST /messages — enviar mensaje (con isLocked opcional)
  @Post()
  async sendMessage(
    @CurrentUser() user: JwtUser,
    @Body() body: { receiverId: string; text: string; isLocked?: boolean },
  ) {
    const message = await this.messagesService.createMessage(
      user.userId,
      body.receiverId,
      body.text,
      body.isLocked ?? false,
    );

    this.gateway.sendMessageToUser(body.receiverId, message);

    return message;
  }

  // GET /messages?conversationId=xxx — obtener mensajes de una conversación
  @Get()
  getMessages(
    @CurrentUser() user: JwtUser,
    @Query('conversationId') conversationId: string,
  ) {
    return this.messagesService.getMessages(conversationId, user.userId);
  }

  // GET /messages/chats — obtener lista de conversaciones
  @Get('chats')
  getChats(@CurrentUser() user: JwtUser) {
    return this.messagesService.getChats(user.userId);
  }

  // POST /messages/:id/unlock — desbloquear un mensaje pagando créditos
  @Post(':id/unlock')
  unlockMessage(@CurrentUser() user: JwtUser, @Param('id') messageId: string) {
    return this.messagesService.unlockMessage(messageId, user.userId);
  }

  // POST /messages/read — marcar mensajes como leídos
  @Post('read')
  markAsRead(
    @CurrentUser() user: JwtUser,
    @Body() body: { conversationId: string },
  ) {
    return this.messagesService.markAsRead(body.conversationId, user.userId);
  }
}
