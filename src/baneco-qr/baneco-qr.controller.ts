import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BanecoQrService } from './baneco-qr.service';
import { CreateBanecoQrDto } from './dto/create-qr.dto';

interface JwtUser {
  userId: string;
}

@ApiTags('Baneco QR')
@Controller('baneco-qr')
export class BanecoQrController {
  private readonly logger = new Logger(BanecoQrController.name);

  constructor(private readonly service: BanecoQrService) {}

  private newReqId() {
    return Math.random().toString(36).slice(2, 9);
  }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generar QR de Banco Economico para un paquete' })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateBanecoQrDto) {
    const reqId = this.newReqId();
    this.logger.log(`[QR][${reqId}] create request arrived userId=${user.userId} packageId=${dto.packageId}`);
    return this.service.createQrForPackage(user.userId, dto.packageId, reqId);
  }

  @Get('status/:qrId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Consultar estado del QR' })
  status(@CurrentUser() user: JwtUser, @Param('qrId') qrId: string) {
    const reqId = this.newReqId();
    return this.service.getStatus(user.userId, qrId, reqId);
  }

  @Delete('cancel/:qrId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Anular un QR pendiente' })
  cancel(@CurrentUser() user: JwtUser, @Param('qrId') qrId: string) {
    const reqId = this.newReqId();
    return this.service.cancel(user.userId, qrId, reqId);
  }

  @Post('reconcile/:qrId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Reconciliar un QR: si el banco confirma que ya esta pagado, acredita los creditos',
  })
  reconcile(@CurrentUser() user: JwtUser, @Param('qrId') qrId: string) {
    const reqId = this.newReqId();
    return this.service.reconcile(user.userId, qrId, reqId);
  }

  // Webhook publico llamado por el banco al confirmar un pago.
  // No requiere JWT — la seguridad la da que el qrId solo lo conoce el banco.
  @Post('notify')
  @ApiOperation({ summary: 'Webhook de notificacion de pago QR (Baneco)' })
  async notify(@Body() body: { Payment?: any; payment?: any }) {
    const payment = body?.Payment ?? body?.payment;
    if (payment?.qrId) {
      await this.service.applyPayment(payment);
    }
    return { responseCode: 0, message: '' };
  }
}
