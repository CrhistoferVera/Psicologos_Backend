import { Module } from '@nestjs/common';
import { ProfessionalsController } from './professionals.controller';
import { PublicProfessionalsController } from './public-professionals.controller';
import { ProfessionalsService } from './professionals.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SpecialtyModule } from '../admin/specialty/specialty.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, NotificationsModule, SpecialtyModule],
  controllers: [PublicProfessionalsController, ProfessionalsController],
  providers: [ProfessionalsService],
})
export class ProfessionalsModule {}

