import { Module } from '@nestjs/common';
import { ClientService} from './client.service';
import {ClientController} from './client.controller';
import { PrismaModule } from '../../../prisma/prisma.module'; // Importante para usar la DB

@Module({
  imports: [PrismaModule],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}