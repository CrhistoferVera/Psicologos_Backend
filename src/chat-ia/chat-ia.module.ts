import { Module } from '@nestjs/common';
import { ChatIaController } from './chat-ia.controller';
import { ChatIaService } from './chat-ia.service';

@Module({
  controllers: [ChatIaController],
  providers: [ChatIaService],
})
export class ChatIaModule {}
