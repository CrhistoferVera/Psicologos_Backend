import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

interface JwtUser {
  userId: string;
  role: string;
}

@ApiTags('Sessions')
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // PROFESSIONAL — mis sesiones (debe ir antes de /:id)
  @Get('my')
  @ApiOperation({ summary: 'Listar mis sesiones (profesional)' })
  getMySessions(@CurrentUser() user: JwtUser) {
    return this.sessionsService.getMySessions(user.userId);
  }

  // USER — mis sesiones activas (pagos APPROVED) — debe ir antes de /:id
  @Get('my-active')
  @ApiOperation({ summary: 'Sesiones con pago aprobado del cliente' })
  getMyActiveSessions(@CurrentUser() user: JwtUser) {
    return this.sessionsService.getMyActiveSessions(user.userId);
  }

  // USER/PROF — listar sesiones OPEN/ACTIVE
  @Get()
  @ApiOperation({ summary: 'Listar sesiones disponibles' })
  getOpenSessions() {
    return this.sessionsService.getOpenSessions();
  }

  // PROFESSIONAL — crear sesion
  @Post()
  @ApiOperation({ summary: 'Crear sesion (profesional)' })
  createSession(@CurrentUser() user: JwtUser, @Body() dto: CreateSessionDto) {
    return this.sessionsService.createSession(user.userId, dto);
  }

  // USER/PROF — detalle de sesion
  @Get(':id')
  @ApiOperation({ summary: 'Detalle de sesion' })
  getSessionById(@Param('id') id: string) {
    return this.sessionsService.getSessionById(id);
  }

  // PROFESSIONAL — editar sesion
  @Patch(':id')
  @ApiOperation({ summary: 'Editar sesion (solo OPEN)' })
  updateSession(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessionsService.updateSession(user.userId, id, dto);
  }

  // PROFESSIONAL — iniciar sesion
  @Post(':id/start')
  @ApiOperation({ summary: 'Iniciar sesion (OPEN → ACTIVE)' })
  startSession(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.startSession(user.userId, id);
  }

  // PROFESSIONAL — terminar sesion
  @Post(':id/end')
  @ApiOperation({ summary: 'Terminar sesion (ACTIVE → COMPLETED)' })
  endSession(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.endSession(user.userId, id);
  }

  // PROFESSIONAL — cancelar sesion
  @Delete(':id')
  @ApiOperation({ summary: 'Cancelar sesion' })
  cancelSession(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.cancelSession(user.userId, id);
  }

  // USER — pagar con QR Baneco
  @Post(':id/pay-qr')
  @ApiOperation({ summary: 'Pagar sesion con QR Baneco (boliviano)' })
  payWithQr(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.paySessionWithQr(user.userId, id);
  }

  // USER — pagar con Stripe
  @Post(':id/pay-stripe')
  @ApiOperation({ summary: 'Pagar sesion con Stripe (extranjero)' })
  payWithStripe(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.paySessionWithStripe(user.userId, id);
  }

  // USER — estado del pago
  @Get(':id/payment-status')
  @ApiOperation({ summary: 'Consultar estado del pago del cliente para esta sesion' })
  getPaymentStatus(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.getMyPaymentStatus(user.userId, id);
  }

  // USER — obtener acceso (conversationId) tras pago aprobado
  @Get(':id/access')
  @ApiOperation({ summary: 'Obtener acceso al chat tras pago aprobado' })
  getSessionAccess(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessionsService.getSessionAccess(user.userId, id);
  }
}
