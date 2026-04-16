import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFlowPaymentDto } from './dto/create-flow-payment.dto';
import { FlowService } from './flow.service';

interface JwtUser {
  userId: string;
}

@ApiTags('Flow')
@Controller('flow')
@UseGuards(JwtAuthGuard)
export class FlowController {
  constructor(private readonly flowService: FlowService) {}

  @Post('create')
  @ApiOperation({ summary: 'Generar URL de checkout/recarga para un paquete de creditos' })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateFlowPaymentDto) {
    return this.flowService.createPaymentUrl(user.userId, dto.packageId);
  }
}
