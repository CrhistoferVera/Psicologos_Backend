import  { Body, Controller, Post, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChatIaService, ChatMessage, ChatRole } from './chat-ia.service';
import { ChatRequestDto } from './dto/chat-ia.dto';

@ApiTags('chat-ia')
@Controller('chat-ia')
export class ChatIaController {
  constructor(private readonly chatIaService: ChatIaService) {}

  @Post(':role')
  @ApiOperation({ summary: 'Enviar mensaje al asistente IA (usuario | anfitriona)' })
  async chat(
    @Param('role') role: string,
    @Body() body: ChatRequestDto,
  ) {
    if (role !== 'paciente' && role !== 'psicologo') {
      throw new BadRequestException('El rol debe ser paciente o psicologo');
    }
    const result = await this.chatIaService.sendMessage(role as ChatRole, body.message, body.history as ChatMessage[], body.sessionId);
    return result;
  }
}
