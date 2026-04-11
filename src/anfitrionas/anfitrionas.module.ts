import { Module } from '@nestjs/common';
import { ProfessionalsController } from './anfitrionas.controller';
import { PublicProfessionalsController } from './public-anfitrionas.controller';
import { ProfessionalsService } from './anfitrionas.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, NotificationsModule],
  controllers: [PublicProfessionalsController, ProfessionalsController],
  providers: [ProfessionalsService],
})
export class ProfessionalsModule {}
