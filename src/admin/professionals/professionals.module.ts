import { Module } from '@nestjs/common';
import { AdminProfessionalsService } from './professionals.service';
import { AdminProfessionalsController } from './professionals.controller';
import { PrismaModule } from '../../../prisma/prisma.module'; // Importante para usar la DB

@Module({
  imports: [PrismaModule],
  controllers: [AdminProfessionalsController],
  providers: [AdminProfessionalsService],
})
export class AdminProfessionalsModule {}

