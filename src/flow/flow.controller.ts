import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { FlowService } from './flow.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

class CreateFlowPaymentDto {
  @IsUUID()
  packageId: string;
}

@ApiTags('Flow')
@Controller('flow')
export class FlowController {
  constructor(private readonly flowService: FlowService) {}

  // El usuario autenticado inicia el pago → recibe la URL de Flow
  @Post('create')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear orden de pago en Flow y obtener URL' })
  createPayment(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateFlowPaymentDto,
  ) {
    return this.flowService.createPayment(user.userId, dto.packageId);
  }

  // Webhook que Flow llama server-to-server — sin autenticación JWT
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Webhook Flow] Confirmación de pago' })
  async confirmPayment(@Body() body: Record<string, string>) {
    const token = body.token;
    if (!token) return { ok: false };
    await this.flowService.confirmPayment(token);
    return { ok: true };
  }
}
