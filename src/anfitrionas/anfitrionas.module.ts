import { Module } from '@nestjs/common';
import { AnfitrioneController } from './anfitrionas.controller';
import { PublicAnfitrioneController } from './public-anfitrionas.controller';
import { AnfitrioneService } from './anfitrionas.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, NotificationsModule, SubscriptionsModule],
  controllers: [PublicAnfitrioneController, AnfitrioneController],
  providers: [AnfitrioneService],
})
export class AnfitrioneModule {}
