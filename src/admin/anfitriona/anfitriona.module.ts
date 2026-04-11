import { Module } from '@nestjs/common';
import { AdminProfessionalsService } from './anfitriona.service';
import { AdminProfessionalsController } from './anfitriona.controller';
import { PrismaModule } from '../../../prisma/prisma.module'; // Importante para usar la DB

@Module({
  imports: [PrismaModule],
  controllers: [AdminProfessionalsController],
  providers: [AdminProfessionalsService],
})
export class AdminProfessionalsModule {}
