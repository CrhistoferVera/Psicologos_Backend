import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { CloudinaryModule } from '../../cloudinary/cloudinary.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AdminRefundRequestsController } from './admin-refund-requests.controller';
import { AdminRefundRequestsService } from './admin-refund-requests.service';

@Module({
  imports: [PrismaModule, CloudinaryModule, NotificationsModule],
  controllers: [AdminRefundRequestsController],
  providers: [AdminRefundRequestsService],
})
export class AdminRefundRequestsModule {}
