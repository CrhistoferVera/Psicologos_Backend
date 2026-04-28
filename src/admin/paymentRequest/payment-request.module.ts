import { Module } from '@nestjs/common';
import { PaymentRequestController } from './payment-request.controller';
import { PaymentRequestService } from './payment-request.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CloudinaryModule } from '../../cloudinary/cloudinary.module';
import { MailModule } from '../../mail/mail.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
    imports: [PrismaModule, CloudinaryModule, MailModule, NotificationsModule],
    controllers: [PaymentRequestController],
    providers: [PaymentRequestService],
})
export class PaymentRequestModule { }
