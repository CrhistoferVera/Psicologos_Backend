import {
    Controller, Patch, Param, Body, UseGuards, Post,
    UseInterceptors, UploadedFile, BadRequestException, Logger
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { WithdrawalStatus } from '@prisma/client';
import { RechargeRequestService } from './payment-request.service';
import { UpdateWithdrawalRequetsDto } from './dto/update-withdrawalRequest.dto';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { NotificationsService } from 'src/notifications/notifications.service';

interface JwtUser { userId: string; }

@ApiTags('Admin - Payment Requests')
@Controller('admin/payment-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PaymentRequestController {

    private readonly logger = new Logger(PaymentRequestController.name);

    constructor(
        private readonly paymentRequestService: RechargeRequestService,
        private readonly cloudinaryService: CloudinaryService,
        private readonly notificationsService: NotificationsService,
    ) { }

    /**
     * APROBAR / RECHAZAR SOLICITUD DE RETIRO DE ANFITRIONA
     */
    @Patch(':id/status')
    @ApiOperation({ summary: 'Aprobar o rechazar solicitud de retiro de anfitriona' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('receipt'))
    async updateStatus(
        @Param('id') id: string,
        @Body() updateDto: UpdateWithdrawalRequetsDto,
        @CurrentUser() admin: JwtUser,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        this.logger.log(`📥 PATCH /admin/payment-requests/${id}/status`);
        this.logger.debug(`status: ${updateDto.status} | file: ${file?.originalname ?? 'NO FILE'}`);

        let receiptData: { url: string; publicId: string } | undefined;

        // Si es APPROVED, el comprobante es obligatorio
        if (updateDto.status === WithdrawalStatus.APPROVED) {
            if (!file) throw new BadRequestException('Debes subir el comprobante de pago.');

            const uploaded = await this.cloudinaryService.uploadWithdrawalProof({
                file,
                userId: admin.userId,
                withdrawalId: id,
            });

            receiptData = { url: uploaded.secureUrl, publicId: uploaded.publicId };
        }

        return this.paymentRequestService.updateDepositStatus(id, updateDto, receiptData);
    }

    // ENDPOINT TEMPORAL DE PRUEBA — eliminar en producción
    @Post('test-notification')
    async testNotification(@Body() body: { fcmToken: string }) {
        await this.notificationsService.sendPushNotification(
            body.fcmToken,
            '✅ Prueba de notificación',
            'Esta es una notificación de prueba desde Pachamama',
            { withdrawalRequestId: 'test-123' }
        );
        return { success: true };
    }
}
