import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PROFESSIONAL_ROLES } from '../common/professional-role';
import { AvailableSlotsQueryDto } from './dto/available-slots-query.dto';
import { BookingListQueryDto } from './dto/booking-list-query.dto';
import { BookingPaymentInitResponseDto } from './dto/booking-payment-init-response.dto';
import { CreateAvailabilityExceptionDto } from './dto/create-availability-exception.dto';
import { CreateAvailabilityRuleDto } from './dto/create-availability-rule.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateSessionOfferingDto } from './dto/create-session-offering.dto';
import { UpdateAvailabilityRuleDto } from './dto/update-availability-rule.dto';
import { UpdateSessionOfferingDto } from './dto/update-session-offering.dto';
import { UpdateSessionOfferingStatusDto } from './dto/update-session-offering-status.dto';
import { BookingsService } from './bookings.service';

interface JwtUser {
  userId: string;
  role: string;
}

@ApiTags('Bookings')
@Controller()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get('professional/session-offerings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Listar sesiones ofrecidas por el profesional autenticado' })
  getMySessionOfferings(@CurrentUser() user: JwtUser) {
    return this.bookingsService.listProfessionalSessionOfferings(user.userId);
  }

  @Post('professional/session-offerings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Crear sesion ofrecida por el profesional autenticado' })
  createSessionOffering(@CurrentUser() user: JwtUser, @Body() dto: CreateSessionOfferingDto) {
    return this.bookingsService.createProfessionalSessionOffering(user.userId, dto);
  }

  @Patch('professional/session-offerings/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Editar sesion ofrecida por el profesional autenticado' })
  updateSessionOffering(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateSessionOfferingDto,
  ) {
    return this.bookingsService.updateProfessionalSessionOffering(user.userId, id, dto);
  }

  @Patch('professional/session-offerings/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Activar o desactivar sesion ofrecida' })
  updateSessionOfferingStatus(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateSessionOfferingStatusDto,
  ) {
    return this.bookingsService.updateProfessionalSessionOfferingStatus(
      user.userId,
      id,
      dto.isActive,
    );
  }

  @Get('professionals/:professionalId/session-offerings')
  @ApiOperation({ summary: 'Listar sesiones activas de un profesional (publico)' })
  getPublicSessionOfferings(@Param('professionalId') professionalId: string) {
    return this.bookingsService.listPublicSessionOfferings(professionalId);
  }

  @Get('professional/availability-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Listar reglas semanales de disponibilidad del profesional autenticado' })
  getAvailabilityRules(@CurrentUser() user: JwtUser) {
    return this.bookingsService.listAvailabilityRules(user.userId);
  }

  @Post('professional/availability-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Crear regla semanal de disponibilidad' })
  createAvailabilityRule(@CurrentUser() user: JwtUser, @Body() dto: CreateAvailabilityRuleDto) {
    return this.bookingsService.createAvailabilityRule(user.userId, dto);
  }

  @Patch('professional/availability-rules/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Editar regla semanal de disponibilidad' })
  updateAvailabilityRule(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateAvailabilityRuleDto,
  ) {
    return this.bookingsService.updateAvailabilityRule(user.userId, id, dto);
  }

  @Delete('professional/availability-rules/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Desactivar regla semanal de disponibilidad' })
  deleteAvailabilityRule(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.bookingsService.deleteAvailabilityRule(user.userId, id);
  }

  @Get('professional/availability-exceptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Listar excepciones de disponibilidad del profesional autenticado' })
  getAvailabilityExceptions(@CurrentUser() user: JwtUser) {
    return this.bookingsService.listAvailabilityExceptions(user.userId);
  }

  @Post('professional/availability-exceptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Crear excepcion de disponibilidad' })
  createAvailabilityException(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateAvailabilityExceptionDto,
  ) {
    return this.bookingsService.createAvailabilityException(user.userId, dto);
  }

  @Delete('professional/availability-exceptions/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Eliminar excepcion de disponibilidad' })
  deleteAvailabilityException(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.bookingsService.deleteAvailabilityException(user.userId, id);
  }

  @Get('professionals/:professionalId/available-slots')
  @ApiOperation({ summary: 'Listar slots disponibles para un profesional y servicio' })
  getAvailableSlots(
    @Param('professionalId') professionalId: string,
    @Query() query: AvailableSlotsQueryDto,
  ) {
    return this.bookingsService.getAvailableSlots(
      professionalId,
      query.sessionOfferingId,
      query.date,
      query.timezone,
    );
  }

  @Post('bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Crear reserva en estado PENDING_PAYMENT' })
  createBooking(@CurrentUser() user: JwtUser, @Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(user.userId, dto);
  }

  @Post('bookings/:bookingId/payment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Iniciar pago para una reserva PENDING_PAYMENT' })
  @ApiResponse({ status: 201, type: BookingPaymentInitResponseDto })
  initBookingPayment(@CurrentUser() user: JwtUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.initBookingPayment(user.userId, bookingId);
  }

  @Get('bookings/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Listar reservas del cliente autenticado' })
  getMyBookings(@CurrentUser() user: JwtUser, @Query() query: BookingListQueryDto) {
    return this.bookingsService.getMyBookings(user.userId, query);
  }

  @Get('bookings/:bookingId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Obtener una reserva del cliente autenticado por ID' })
  getMyBookingById(@CurrentUser() user: JwtUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.getMyBookingById(user.userId, bookingId);
  }

  @Get('professional/bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PROFESSIONAL_ROLES)
  @ApiOperation({ summary: 'Listar reservas del profesional autenticado' })
  getProfessionalBookings(@CurrentUser() user: JwtUser, @Query() query: BookingListQueryDto) {
    return this.bookingsService.getProfessionalBookings(user.userId, query);
  }
}
