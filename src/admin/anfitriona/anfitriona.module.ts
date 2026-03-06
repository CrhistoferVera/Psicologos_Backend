import { Module } from '@nestjs/common';
import { AnfitrionaService } from './anfitriona.service';
import { AnfitrionaController } from './anfitriona.controller';
import { PrismaModule } from '../../../prisma/prisma.module'; // Importante para usar la DB

@Module({
  imports: [PrismaModule],
  controllers: [AnfitrionaController],
  providers: [AnfitrionaService],
})
export class AnfitrionaModule {}