import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Booking,
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  Prisma,
  ProfessionalAvailabilityException,
  TransactionType,
  UserRole,
  WeekDay,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import { SystemConfigService } from '../system-config/system-config.service';
import { BanecoQrService } from '../baneco-qr/baneco-qr.service';
import { StripeService } from '../stripe/stripe.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BILLING_REGION_BOLIVIA,
  BILLING_REGION_INTERNATIONAL,
  CURRENCY_BOB,
  CURRENCY_USD,
  deriveBillingFields,
} from '../common/phone-metadata.util';
import { PROFESSIONAL_ROLES } from '../common/professional-role';
import { CreateSessionOfferingDto } from './dto/create-session-offering.dto';
import { UpdateSessionOfferingDto } from './dto/update-session-offering.dto';
import { CreateAvailabilityRuleDto } from './dto/create-availability-rule.dto';
import { UpdateAvailabilityRuleDto } from './dto/update-availability-rule.dto';
import { CreateAvailabilityExceptionDto } from './dto/create-availability-exception.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingListQueryDto } from './dto/booking-list-query.dto';
import { buildActiveBookingOverlapWhere } from './helpers/booking-query.helper';
import { allocateCreditDebit } from '../wallet/utils/credit-allocation.util';
import { BookingEarningsService } from '../booking-earnings/booking-earnings.service';
import {
  assertValidDate,
  ensureValidTimeZone,
  getLocalDateKey,
  getLocalMinutes,
  getWeekDayForDate,
  intervalsOverlap,
  minutesToTime,
  parseTimeToMinutes,
  validateTimeRange,
  zonedDateTimeToUtc,
  DEFAULT_BOOKING_TIMEZONE,
} from './helpers/timezone.helper';

type PrismaTx = PrismaService | Prisma.TransactionClient;

export type CommunicationAccessReason =
  | 'NO_CONFIRMED_BOOKING'
  | 'SESSION_NOT_STARTED'
  | 'SESSION_ENDED'
  | 'PAYMENT_PENDING'
  | 'UNKNOWN';

export type CommunicationAccessResult = {
  allowed: boolean;
  bookingId: string | null;
  reason: CommunicationAccessReason | null;
  sessionStartsAt: Date | null;
  sessionEndsAt: Date | null;
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private static readonly HARD_FALLBACK_BOB_TO_USD_RATE = 6.96;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly systemConfigService: SystemConfigService,
    private readonly banecoQrService: BanecoQrService,
    private readonly stripeService: StripeService,
    private readonly notificationsService: NotificationsService,
    private readonly bookingEarningsService: BookingEarningsService,
  ) {}

  private newReqId() {
    return Math.random().toString(36).slice(2, 9);
  }

  private isProfessionalRole(role: UserRole) {
    return PROFESSIONAL_ROLES.includes(role);
  }

  private resolveCommunicationPair(
    currentUser: { id: string; role: UserRole },
    otherUser: { id: string; role: UserRole },
  ) {
    const currentIsProfessional = this.isProfessionalRole(currentUser.role);
    const otherIsProfessional = this.isProfessionalRole(otherUser.role);

    if (currentUser.role === UserRole.USER && otherIsProfessional) {
      return {
        clientId: currentUser.id,
        professionalId: otherUser.id,
      };
    }

    if (currentIsProfessional && otherUser.role === UserRole.USER) {
      return {
        clientId: otherUser.id,
        professionalId: currentUser.id,
      };
    }

    return null;
  }

  private getCommunicationDeniedMessage(
    reason: CommunicationAccessReason | null,
    mode: 'MESSAGE' | 'CALL',
  ) {
    const actionLabel = mode === 'CALL' ? 'iniciar llamadas' : 'enviar mensajes';

    if (reason === 'PAYMENT_PENDING') {
      return `Solo puedes ${actionLabel} cuando la reserva este pagada y activa.`;
    }

    if (reason === 'SESSION_NOT_STARTED') {
      return `Solo puedes ${actionLabel} durante una sesion activa.`;
    }

    if (reason === 'SESSION_ENDED') {
      return `Solo puedes ${actionLabel} durante una sesion activa.`;
    }

    if (reason === 'NO_CONFIRMED_BOOKING') {
      return `Solo puedes ${actionLabel} durante una sesion activa.`;
    }

    return `Solo puedes ${actionLabel} durante una sesion activa.`;
  }

  private mapAccessResultForResponse(result: CommunicationAccessResult) {
    const reasonMessageMap: Record<CommunicationAccessReason, string> = {
      NO_CONFIRMED_BOOKING: 'Reserva una sesion para habilitar mensajes y llamadas.',
      SESSION_NOT_STARTED: 'Tu sesion aun no ha iniciado.',
      SESSION_ENDED: 'Tu sesion ya finalizo.',
      PAYMENT_PENDING: 'La reserva existe, pero el pago aun no esta confirmado.',
      UNKNOWN: 'No se pudo validar el acceso de comunicacion.',
    };

    return {
      allowed: result.allowed,
      bookingId: result.bookingId,
      sessionStartsAt: result.sessionStartsAt ? result.sessionStartsAt.toISOString() : null,
      sessionEndsAt: result.sessionEndsAt ? result.sessionEndsAt.toISOString() : null,
      reason: result.reason,
      message: result.reason ? reasonMessageMap[result.reason] : null,
    };
  }

  async hasActiveBookingAccess(currentUserId: string, otherUserId: string): Promise<CommunicationAccessResult> {
    if (!currentUserId || !otherUserId) {
      return {
        allowed: false,
        bookingId: null,
        reason: 'UNKNOWN',
        sessionStartsAt: null,
        sessionEndsAt: null,
      };
    }

    const [currentUser, otherUser] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: currentUserId },
        select: { id: true, role: true, isActive: true },
      }),
      this.prisma.user.findUnique({
        where: { id: otherUserId },
        select: { id: true, role: true, isActive: true },
      }),
    ]);

    if (!currentUser || !otherUser || !currentUser.isActive || !otherUser.isActive) {
      return {
        allowed: false,
        bookingId: null,
        reason: 'UNKNOWN',
        sessionStartsAt: null,
        sessionEndsAt: null,
      };
    }

    const pair = this.resolveCommunicationPair(currentUser, otherUser);
    if (!pair) {
      return {
        allowed: false,
        bookingId: null,
        reason: 'UNKNOWN',
        sessionStartsAt: null,
        sessionEndsAt: null,
      };
    }

    const now = new Date();

    const activePaidBooking = await this.prisma.booking.findFirst({
      where: {
        clientId: pair.clientId,
        professionalId: pair.professionalId,
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        scheduledStartAt: { lte: now },
        scheduledEndAt: { gte: now },
      },
      orderBy: { scheduledStartAt: 'asc' },
      select: {
        id: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    if (activePaidBooking) {
      return {
        allowed: true,
        bookingId: activePaidBooking.id,
        reason: null,
        sessionStartsAt: activePaidBooking.scheduledStartAt,
        sessionEndsAt: activePaidBooking.scheduledEndAt,
      };
    }

    const activeButUnpaidBooking = await this.prisma.booking.findFirst({
      where: {
        clientId: pair.clientId,
        professionalId: pair.professionalId,
        scheduledStartAt: { lte: now },
        scheduledEndAt: { gte: now },
        OR: [
          {
            status: BookingStatus.CONFIRMED,
            paymentStatus: { not: BookingPaymentStatus.PAID },
          },
          {
            status: BookingStatus.PENDING_PAYMENT,
          },
        ],
      },
      orderBy: { scheduledStartAt: 'asc' },
      select: {
        id: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    if (activeButUnpaidBooking) {
      return {
        allowed: false,
        bookingId: activeButUnpaidBooking.id,
        reason: 'PAYMENT_PENDING',
        sessionStartsAt: activeButUnpaidBooking.scheduledStartAt,
        sessionEndsAt: activeButUnpaidBooking.scheduledEndAt,
      };
    }

    const nextConfirmedPaidBooking = await this.prisma.booking.findFirst({
      where: {
        clientId: pair.clientId,
        professionalId: pair.professionalId,
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        scheduledStartAt: { gt: now },
      },
      orderBy: { scheduledStartAt: 'asc' },
      select: {
        id: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    if (nextConfirmedPaidBooking) {
      return {
        allowed: false,
        bookingId: nextConfirmedPaidBooking.id,
        reason: 'SESSION_NOT_STARTED',
        sessionStartsAt: nextConfirmedPaidBooking.scheduledStartAt,
        sessionEndsAt: nextConfirmedPaidBooking.scheduledEndAt,
      };
    }

    const nextPendingPaymentBooking = await this.prisma.booking.findFirst({
      where: {
        clientId: pair.clientId,
        professionalId: pair.professionalId,
        status: BookingStatus.PENDING_PAYMENT,
        paymentStatus: BookingPaymentStatus.PENDING,
        scheduledStartAt: { gt: now },
      },
      orderBy: { scheduledStartAt: 'asc' },
      select: {
        id: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    if (nextPendingPaymentBooking) {
      return {
        allowed: false,
        bookingId: nextPendingPaymentBooking.id,
        reason: 'PAYMENT_PENDING',
        sessionStartsAt: nextPendingPaymentBooking.scheduledStartAt,
        sessionEndsAt: nextPendingPaymentBooking.scheduledEndAt,
      };
    }

    const lastConfirmedPaidBooking = await this.prisma.booking.findFirst({
      where: {
        clientId: pair.clientId,
        professionalId: pair.professionalId,
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        scheduledEndAt: { lt: now },
      },
      orderBy: { scheduledEndAt: 'desc' },
      select: {
        id: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    if (lastConfirmedPaidBooking) {
      return {
        allowed: false,
        bookingId: lastConfirmedPaidBooking.id,
        reason: 'SESSION_ENDED',
        sessionStartsAt: lastConfirmedPaidBooking.scheduledStartAt,
        sessionEndsAt: lastConfirmedPaidBooking.scheduledEndAt,
      };
    }

    return {
      allowed: false,
      bookingId: null,
      reason: 'NO_CONFIRMED_BOOKING',
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  async assertActiveBookingAccess(
    currentUserId: string,
    otherUserId: string,
    mode: 'MESSAGE' | 'CALL' = 'MESSAGE',
  ) {
    const result = await this.hasActiveBookingAccess(currentUserId, otherUserId);
    if (!result.allowed) {
      throw new ForbiddenException(this.getCommunicationDeniedMessage(result.reason, mode));
    }
    return result;
  }

  async getCommunicationAccess(currentUserId: string, otherUserId: string) {
    const result = await this.hasActiveBookingAccess(currentUserId, otherUserId);
    return this.mapAccessResultForResponse(result);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingBookingsCron() {
    await this.expirePendingBookings();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sendBookingSessionRemindersCron() {
    await this.sendBookingReminder10MinBeforeStart();
    await this.sendBookingReminder15MinBeforeEnd();
  }

  async expirePendingBookings(tx?: PrismaTx): Promise<number> {
    const client = tx ?? this.prisma;
    const now = new Date();

    const expiredBookings = await client.booking.updateMany({
      where: {
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: { lte: now },
      },
      data: {
        status: BookingStatus.EXPIRED,
        paymentStatus: BookingPaymentStatus.EXPIRED,
      },
    });

    if (expiredBookings.count > 0) {
      await client.bookingPayment.updateMany({
        where: {
          booking: {
            status: BookingStatus.EXPIRED,
          },
          status: BookingPaymentStatus.PENDING,
        },
        data: {
          status: BookingPaymentStatus.EXPIRED,
        },
      });
    }

    return expiredBookings.count;
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return Number(value);
  }

  private fullName(user?: { firstName?: string | null; lastName?: string | null }, fallback = 'Usuario') {
    const first = user?.firstName?.trim() ?? '';
    const last = user?.lastName?.trim() ?? '';
    const name = `${first} ${last}`.trim();
    return name || fallback;
  }

  private formatBookingDateTime(date: Date, timezone: string) {
    const tz = timezone || DEFAULT_BOOKING_TIMEZONE;
    return new Intl.DateTimeFormat('es-BO', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  async sendBookingReminder10MinBeforeStart() {
    const now = new Date();
    const from = new Date(now.getTime() + 9 * 60 * 1000);
    const to = new Date(now.getTime() + 11 * 60 * 1000);

    const candidates = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        reminder10BeforeStartSentAt: null,
        scheduledStartAt: {
          gte: from,
          lte: to,
        },
      },
      select: {
        id: true,
        timezone: true,
        scheduledStartAt: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            fcmToken: true,
          },
        },
        professional: {
          select: {
            firstName: true,
            lastName: true,
            fcmToken: true,
          },
        },
      },
    });

    for (const booking of candidates) {
      try {
        const claim = await this.prisma.booking.updateMany({
          where: {
            id: booking.id,
            reminder10BeforeStartSentAt: null,
            status: BookingStatus.CONFIRMED,
            paymentStatus: BookingPaymentStatus.PAID,
          },
          data: {
            reminder10BeforeStartSentAt: new Date(),
          },
        });

        if (claim.count === 0) continue;

        const professionalName = this.fullName(booking.professional, 'psicologo');
        const clientName = this.fullName(booking.client, 'cliente');
        const startAtFormatted = this.formatBookingDateTime(booking.scheduledStartAt, booking.timezone);

        if (booking.client?.fcmToken) {
          await this.notificationsService.sendPushNotification(
            booking.client.fcmToken,
            'Tu sesion empieza pronto',
            `Tu sesion con ${professionalName} empieza en 10 minutos.`,
            {
              type: 'BOOKING_REMINDER_10_BEFORE_START',
              bookingId: booking.id,
              startsAt: booking.scheduledStartAt.toISOString(),
            },
          );
        } else {
          this.logger.warn(
            `[BOOKING-REMINDER-10-START] bookingId=${booking.id} target=client reason=NO_FCM_TOKEN startsAt=${startAtFormatted}`,
          );
        }

        if (booking.professional?.fcmToken) {
          await this.notificationsService.sendPushNotification(
            booking.professional.fcmToken,
            'Tu sesion empieza pronto',
            `Tu sesion con ${clientName} empieza en 10 minutos.`,
            {
              type: 'BOOKING_REMINDER_10_BEFORE_START',
              bookingId: booking.id,
              startsAt: booking.scheduledStartAt.toISOString(),
            },
          );
        } else {
          this.logger.warn(
            `[BOOKING-REMINDER-10-START] bookingId=${booking.id} target=professional reason=NO_FCM_TOKEN startsAt=${startAtFormatted}`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `[BOOKING-REMINDER-10-START] bookingId=${booking.id} failed reason=${error?.message ?? 'unknown'}`,
        );
      }
    }
  }

  async sendBookingReminder15MinBeforeEnd() {
    const now = new Date();
    const from = new Date(now.getTime() + 14 * 60 * 1000);
    const to = new Date(now.getTime() + 16 * 60 * 1000);

    const candidates = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        reminder15BeforeEndSentAt: null,
        scheduledEndAt: {
          gte: from,
          lte: to,
        },
      },
      select: {
        id: true,
        timezone: true,
        scheduledEndAt: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            fcmToken: true,
          },
        },
        professional: {
          select: {
            firstName: true,
            lastName: true,
            fcmToken: true,
          },
        },
      },
    });

    for (const booking of candidates) {
      try {
        const claim = await this.prisma.booking.updateMany({
          where: {
            id: booking.id,
            reminder15BeforeEndSentAt: null,
            status: BookingStatus.CONFIRMED,
            paymentStatus: BookingPaymentStatus.PAID,
          },
          data: {
            reminder15BeforeEndSentAt: new Date(),
          },
        });

        if (claim.count === 0) continue;

        const clientName = this.fullName(booking.client, 'cliente');
        const endAtFormatted = this.formatBookingDateTime(booking.scheduledEndAt, booking.timezone);

        if (booking.client?.fcmToken) {
          await this.notificationsService.sendPushNotification(
            booking.client.fcmToken,
            'Tu sesion esta por terminar',
            'Tu sesion termina en 15 minutos.',
            {
              type: 'BOOKING_REMINDER_15_BEFORE_END',
              bookingId: booking.id,
              endsAt: booking.scheduledEndAt.toISOString(),
            },
          );
        } else {
          this.logger.warn(
            `[BOOKING-REMINDER-15-END] bookingId=${booking.id} target=client reason=NO_FCM_TOKEN endsAt=${endAtFormatted}`,
          );
        }

        if (booking.professional?.fcmToken) {
          await this.notificationsService.sendPushNotification(
            booking.professional.fcmToken,
            'Tu sesion esta por terminar',
            `Tu sesion con ${clientName} termina en 15 minutos.`,
            {
              type: 'BOOKING_REMINDER_15_BEFORE_END',
              bookingId: booking.id,
              endsAt: booking.scheduledEndAt.toISOString(),
            },
          );
        } else {
          this.logger.warn(
            `[BOOKING-REMINDER-15-END] bookingId=${booking.id} target=professional reason=NO_FCM_TOKEN endsAt=${endAtFormatted}`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `[BOOKING-REMINDER-15-END] bookingId=${booking.id} failed reason=${error?.message ?? 'unknown'}`,
        );
      }
    }
  }

  private async getBobToUsdRate(): Promise<number> {
    try {
      const runtimeConfig = await this.systemConfigService.getRuntimeConfig();
      const configRate = Number(runtimeConfig.usdExchangeRate);
      if (Number.isFinite(configRate) && configRate > 0) {
        return configRate;
      }
      this.logger.warn(
        `[FX] SystemConfig.usdExchangeRate inválido (${runtimeConfig.usdExchangeRate}). Se intentará fallback.`,
      );
    } catch (error: any) {
      this.logger.warn(
        `[FX] No se pudo leer SystemConfig.usdExchangeRate. Se intentará fallback. reason=${error?.message ?? 'unknown'}`,
      );
    }

    const envRaw = this.config.get<string>('BOB_TO_USD_RATE');
    const envRate = envRaw ? Number(envRaw) : NaN;
    if (Number.isFinite(envRate) && envRate > 0) {
      this.logger.warn('[FX] Usando fallback BOB_TO_USD_RATE desde entorno.');
      return envRate;
    }

    this.logger.warn(
      `[FX] Usando fallback duro ${BookingsService.HARD_FALLBACK_BOB_TO_USD_RATE} para BOB→USD.`,
    );
    return BookingsService.HARD_FALLBACK_BOB_TO_USD_RATE;
  }

  private formatOffering(offering: {
    id: string;
    professionalId: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    priceBob: Prisma.Decimal;
    priceUsd: Prisma.Decimal;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }, bobToUsdRate: number) {
    return {
      ...offering,
      priceBob: Number(offering.priceBob),
      priceUsd: Math.round((Number(offering.priceBob) / bobToUsdRate) * 100) / 100,
    };
  }

  private toDateOnlyUtc(dateValue: string): Date {
    const dateOnly = dateValue.slice(0, 10);
    assertValidDate(dateOnly);
    return new Date(`${dateOnly}T00:00:00.000Z`);
  }

  private getDateRangeFilter(query: BookingListQueryDto): Prisma.BookingWhereInput {
    const where: Prisma.BookingWhereInput = {};

    if (query.status) where.status = query.status;

    if (query.from || query.to) {
      where.scheduledStartAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    return where;
  }

  private async ensureProfessionalExists(professionalId: string, allowInactive = false) {
    const professional = await this.prisma.user.findFirst({
      where: {
        id: professionalId,
        role: { in: PROFESSIONAL_ROLES },
      },
      select: { id: true, isActive: true, role: true },
    });

    if (!professional || (!allowInactive && !professional.isActive)) {
      throw new NotFoundException('Profesional no encontrado o inactivo.');
    }

    return professional;
  }

  private async ensureRuleDoesNotOverlap(
    professionalId: string,
    dayOfWeek: WeekDay,
    startTime: string,
    endTime: string,
    ruleIdToIgnore?: string,
  ) {
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);

    const existing = await this.prisma.professionalAvailabilityRule.findMany({
      where: {
        professionalId,
        dayOfWeek,
        isActive: true,
        ...(ruleIdToIgnore ? { id: { not: ruleIdToIgnore } } : {}),
      },
      select: { id: true, startTime: true, endTime: true },
    });

    const hasOverlap = existing.some((rule) =>
      intervalsOverlap(
        startMinutes,
        endMinutes,
        parseTimeToMinutes(rule.startTime),
        parseTimeToMinutes(rule.endTime),
      ),
    );

    if (hasOverlap) {
      throw new BadRequestException('La regla se solapa con otra disponibilidad activa del mismo dia.');
    }
  }

  private validateExceptionInput(dto: CreateAvailabilityExceptionDto) {
    const isFullDay = dto.isFullDay ?? false;

    if (isFullDay) return;

    if (!dto.startTime || !dto.endTime) {
      throw new BadRequestException('startTime y endTime son obligatorios cuando isFullDay=false.');
    }

    validateTimeRange(dto.startTime, dto.endTime);
  }

  private buildSlotBoundaries(date: string, timeZone: string, durationMinutes: number) {
    const dayStart = zonedDateTimeToUtc(date, '00:00', timeZone);
    const nextDayUtc = new Date(`${date}T00:00:00.000Z`);
    nextDayUtc.setUTCDate(nextDayUtc.getUTCDate() + 1);
    const nextDate = nextDayUtc.toISOString().slice(0, 10);
    const dayEnd = zonedDateTimeToUtc(nextDate, '00:00', timeZone);

    return {
      dayStart,
      dayEnd,
      durationMinutes,
    };
  }

  private normalizeBookingRegion(user: { billingRegion: string | null; phoneCountryIso: string | null }) {
    const billingRegion = (user.billingRegion ?? '').trim().toUpperCase();

    if (billingRegion === BILLING_REGION_BOLIVIA) {
      return { currency: CURRENCY_BOB, paymentMethod: BookingPaymentMethod.WALLET };
    }

    if (billingRegion === BILLING_REGION_INTERNATIONAL) {
      return { currency: CURRENCY_USD, paymentMethod: BookingPaymentMethod.WALLET };
    }

    // billingRegion es null: derivar desde el código de país del teléfono
    const derived = deriveBillingFields(user.phoneCountryIso ?? '');
    if (derived.billingRegion === BILLING_REGION_BOLIVIA) {
      return { currency: CURRENCY_BOB, paymentMethod: BookingPaymentMethod.WALLET };
    }
    return { currency: CURRENCY_USD, paymentMethod: BookingPaymentMethod.WALLET };
  }

  private validateBookingPaymentMethodAndCurrency(booking: {
    paymentMethod: BookingPaymentMethod | null;
    currency: string;
  }) {
    if (!booking.paymentMethod) {
      throw new BadRequestException('El booking no tiene metodo de pago definido.');
    }

    if (booking.paymentMethod === BookingPaymentMethod.WALLET) {
      return;
    }

    if (
      booking.paymentMethod === BookingPaymentMethod.BANECO_QR &&
      booking.currency !== CURRENCY_BOB
    ) {
      throw new BadRequestException('Inconsistencia de booking: BANECO_QR requiere currency BOB.');
    }

    if (
      booking.paymentMethod === BookingPaymentMethod.STRIPE &&
      booking.currency !== CURRENCY_USD
    ) {
      throw new BadRequestException('Inconsistencia de booking: STRIPE requiere currency USD.');
    }
  }

  private async markBookingAsExpired(tx: PrismaTx, bookingId: string) {
    await tx.booking.updateMany({
      where: {
        id: bookingId,
        status: BookingStatus.PENDING_PAYMENT,
      },
      data: {
        status: BookingStatus.EXPIRED,
        paymentStatus: BookingPaymentStatus.EXPIRED,
      },
    });

    await tx.bookingPayment.updateMany({
      where: {
        bookingId,
        status: BookingPaymentStatus.PENDING,
      },
      data: {
        status: BookingPaymentStatus.EXPIRED,
      },
    });
  }

  private async ensurePendingBookingPaymentRecord(
    tx: PrismaTx,
    booking: {
      id: string;
      paymentMethod: BookingPaymentMethod;
      currency: string;
      priceBob: Prisma.Decimal;
      priceUsd: Prisma.Decimal;
    },
  ) {
    const pending = await tx.bookingPayment.findFirst({
      where: {
        bookingId: booking.id,
        method: booking.paymentMethod,
        status: BookingPaymentStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (pending) {
      return tx.bookingPayment.update({
        where: { id: pending.id },
        data: {
          amountBob: booking.priceBob,
          amountUsd: booking.priceUsd,
          currency: booking.currency,
        },
      });
    }

    return tx.bookingPayment.create({
      data: {
        bookingId: booking.id,
        method: booking.paymentMethod,
        status: BookingPaymentStatus.PENDING,
        amountBob: booking.priceBob,
        amountUsd: booking.priceUsd,
        currency: booking.currency,
      },
    });
  }

  private async assertSlotIsBookable(
    tx: PrismaTx,
    payload: {
      professionalId: string;
      sessionOfferingId: string;
      scheduledStartAt: Date;
      scheduledEndAt: Date;
      durationMinutes: number;
      timeZone: string;
    },
  ) {
    const localDate = getLocalDateKey(payload.scheduledStartAt, payload.timeZone);
    const localStartMinutes = getLocalMinutes(payload.scheduledStartAt, payload.timeZone);

    const dayOfWeek = getWeekDayForDate(localDate, payload.timeZone);

    const rules = await tx.professionalAvailabilityRule.findMany({
      where: {
        professionalId: payload.professionalId,
        dayOfWeek,
        isActive: true,
      },
      orderBy: { startTime: 'asc' },
    });

    if (!rules.length) {
      throw new BadRequestException('El profesional no tiene disponibilidad para esa fecha.');
    }

    const containedRule = rules.find((rule) => {
      const ruleStart = parseTimeToMinutes(rule.startTime);
      const ruleEnd = parseTimeToMinutes(rule.endTime);
      const slotEnd = localStartMinutes + payload.durationMinutes;

      if (localStartMinutes < ruleStart || slotEnd > ruleEnd) return false;
      return (localStartMinutes - ruleStart) % payload.durationMinutes === 0;
    });

    if (!containedRule) {
      throw new BadRequestException('El horario solicitado no coincide con una franja disponible del profesional.');
    }

    const exceptionDate = new Date(`${localDate}T00:00:00.000Z`);

    const exceptions = await tx.professionalAvailabilityException.findMany({
      where: {
        professionalId: payload.professionalId,
        date: exceptionDate,
      },
    });

    if (exceptions.some((item) => item.isFullDay)) {
      throw new BadRequestException('El profesional bloqueo la fecha seleccionada.');
    }

    const blockedRanges = exceptions
      .filter((item) => !item.isFullDay && item.startTime && item.endTime)
      .map((item) => ({
        start: parseTimeToMinutes(item.startTime as string),
        end: parseTimeToMinutes(item.endTime as string),
      }));

    const localEndMinutes = localStartMinutes + payload.durationMinutes;
    const blocked = blockedRanges.some((range) =>
      intervalsOverlap(localStartMinutes, localEndMinutes, range.start, range.end),
    );

    if (blocked) {
      throw new BadRequestException('El horario solicitado esta bloqueado por una excepcion.');
    }

    const now = new Date();
    const overlapping = await tx.booking.findFirst({
      where: buildActiveBookingOverlapWhere(
        payload.professionalId,
        payload.scheduledStartAt,
        payload.scheduledEndAt,
        now,
      ),
      select: { id: true },
    });

    if (overlapping) {
      throw new BadRequestException('El horario solicitado ya fue reservado.');
    }
  }

  async listProfessionalSessionOfferings(professionalId: string) {
    await this.ensureProfessionalExists(professionalId, true);
    const bobToUsdRate = await this.getBobToUsdRate();

    const rows = await this.prisma.professionalSessionOffering.findMany({
      where: { professionalId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => this.formatOffering(row, bobToUsdRate));
  }

  async createProfessionalSessionOffering(professionalId: string, dto: CreateSessionOfferingDto) {
    await this.ensureProfessionalExists(professionalId, true);

    if (dto.durationMinutes <= 0) {
      throw new BadRequestException('durationMinutes debe ser mayor que 0.');
    }

    if (dto.priceBob <= 0) {
      throw new BadRequestException('priceBob debe ser mayor que 0.');
    }

    const rate = await this.getBobToUsdRate();
    const priceUsd = Math.round((dto.priceBob / rate) * 100) / 100;

    const created = await this.prisma.professionalSessionOffering.create({
      data: {
        professionalId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        durationMinutes: dto.durationMinutes,
        priceBob: new Prisma.Decimal(dto.priceBob),
        priceUsd: new Prisma.Decimal(priceUsd),
      },
    });

    return this.formatOffering(created, rate);
  }

  async updateProfessionalSessionOffering(
    professionalId: string,
    offeringId: string,
    dto: UpdateSessionOfferingDto,
  ) {
    const existing = await this.prisma.professionalSessionOffering.findUnique({
      where: { id: offeringId },
    });

    if (!existing) {
      throw new NotFoundException('Sesion ofrecida no encontrada.');
    }

    if (existing.professionalId !== professionalId) {
      throw new ForbiddenException('No puedes editar sesiones ofrecidas de otro profesional.');
    }

    const payload: Prisma.ProfessionalSessionOfferingUpdateInput = {};

    if (dto.title !== undefined) payload.title = dto.title.trim();
    if (dto.description !== undefined) payload.description = dto.description?.trim() || null;
    if (dto.durationMinutes !== undefined) {
      if (dto.durationMinutes <= 0) {
        throw new BadRequestException('durationMinutes debe ser mayor que 0.');
      }
      payload.durationMinutes = dto.durationMinutes;
    }

    const bobToUsdRate = await this.getBobToUsdRate();

    if (dto.priceBob !== undefined) {
      if (dto.priceBob <= 0) throw new BadRequestException('priceBob debe ser mayor que 0.');
      const priceUsd = Math.round((dto.priceBob / bobToUsdRate) * 100) / 100;
      payload.priceBob = new Prisma.Decimal(dto.priceBob);
      payload.priceUsd = new Prisma.Decimal(priceUsd);
    }

    const updated = await this.prisma.professionalSessionOffering.update({
      where: { id: offeringId },
      data: payload,
    });

    return this.formatOffering(updated, bobToUsdRate);
  }

  async updateProfessionalSessionOfferingStatus(
    professionalId: string,
    offeringId: string,
    isActive: boolean,
  ) {
    const existing = await this.prisma.professionalSessionOffering.findUnique({
      where: { id: offeringId },
      select: { id: true, professionalId: true },
    });

    if (!existing) throw new NotFoundException('Sesion ofrecida no encontrada.');
    if (existing.professionalId !== professionalId) {
      throw new ForbiddenException('No puedes editar sesiones ofrecidas de otro profesional.');
    }

    const bobToUsdRate = await this.getBobToUsdRate();

    const updated = await this.prisma.professionalSessionOffering.update({
      where: { id: offeringId },
      data: { isActive },
    });

    return this.formatOffering(updated, bobToUsdRate);
  }

  async listPublicSessionOfferings(professionalId: string) {
    await this.ensureProfessionalExists(professionalId);
    const bobToUsdRate = await this.getBobToUsdRate();

    const rows = await this.prisma.professionalSessionOffering.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        durationMinutes: true,
        priceBob: true,
        priceUsd: true,
      },
    });

    return rows.map((row) => ({
      ...row,
      priceBob: Number(row.priceBob),
      priceUsd: Math.round((Number(row.priceBob) / bobToUsdRate) * 100) / 100,
    }));
  }

  async listAvailabilityRules(professionalId: string) {
    const rules = await this.prisma.professionalAvailabilityRule.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return rules;
  }

  async createAvailabilityRule(professionalId: string, dto: CreateAvailabilityRuleDto) {
    validateTimeRange(dto.startTime, dto.endTime);
    await this.ensureRuleDoesNotOverlap(
      professionalId,
      dto.dayOfWeek,
      dto.startTime,
      dto.endTime,
    );

    return this.prisma.professionalAvailabilityRule.create({
      data: {
        professionalId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateAvailabilityRule(
    professionalId: string,
    ruleId: string,
    dto: UpdateAvailabilityRuleDto,
  ) {
    const existing = await this.prisma.professionalAvailabilityRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) throw new NotFoundException('Regla de disponibilidad no encontrada.');
    if (existing.professionalId !== professionalId) {
      throw new ForbiddenException('No puedes modificar reglas de otro profesional.');
    }

    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;

    validateTimeRange(startTime, endTime);
    await this.ensureRuleDoesNotOverlap(professionalId, dayOfWeek, startTime, endTime, ruleId);

    return this.prisma.professionalAvailabilityRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteAvailabilityRule(professionalId: string, ruleId: string) {
    const existing = await this.prisma.professionalAvailabilityRule.findUnique({
      where: { id: ruleId },
      select: { id: true, professionalId: true },
    });

    if (!existing) throw new NotFoundException('Regla de disponibilidad no encontrada.');
    if (existing.professionalId !== professionalId) {
      throw new ForbiddenException('No puedes eliminar reglas de otro profesional.');
    }

    await this.prisma.professionalAvailabilityRule.update({
      where: { id: ruleId },
      data: { isActive: false },
    });

    return { success: true };
  }

  async listAvailabilityExceptions(professionalId: string) {
    return this.prisma.professionalAvailabilityException.findMany({
      where: { professionalId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }

  async createAvailabilityException(
    professionalId: string,
    dto: CreateAvailabilityExceptionDto,
  ) {
    this.validateExceptionInput(dto);

    return this.prisma.professionalAvailabilityException.create({
      data: {
        professionalId,
        date: this.toDateOnlyUtc(dto.date),
        startTime: dto.isFullDay ? null : (dto.startTime ?? null),
        endTime: dto.isFullDay ? null : (dto.endTime ?? null),
        isFullDay: dto.isFullDay ?? false,
        reason: dto.reason?.trim() || null,
      },
    });
  }

  async deleteAvailabilityException(professionalId: string, exceptionId: string) {
    const existing = await this.prisma.professionalAvailabilityException.findUnique({
      where: { id: exceptionId },
      select: { id: true, professionalId: true },
    });

    if (!existing) throw new NotFoundException('Excepcion no encontrada.');
    if (existing.professionalId !== professionalId) {
      throw new ForbiddenException('No puedes eliminar excepciones de otro profesional.');
    }

    await this.prisma.professionalAvailabilityException.delete({ where: { id: exceptionId } });
    return { success: true };
  }

  async getAvailableSlots(
    professionalId: string,
    sessionOfferingId: string,
    date: string,
    timezone?: string,
  ) {
    const normalizedDate = date.slice(0, 10);
    assertValidDate(normalizedDate);

    await this.expirePendingBookings();
    await this.ensureProfessionalExists(professionalId);

    const offering = await this.prisma.professionalSessionOffering.findFirst({
      where: {
        id: sessionOfferingId,
        professionalId,
        isActive: true,
      },
      select: { durationMinutes: true },
    });

    if (!offering) {
      throw new NotFoundException('Sesion ofrecida no encontrada o inactiva.');
    }

    const tz = ensureValidTimeZone(timezone ?? DEFAULT_BOOKING_TIMEZONE);
    const dayOfWeek = getWeekDayForDate(normalizedDate, tz);

    const rules = await this.prisma.professionalAvailabilityRule.findMany({
      where: {
        professionalId,
        dayOfWeek,
        isActive: true,
      },
      orderBy: { startTime: 'asc' },
    });

    if (!rules.length) return [];

    const exceptionDate = new Date(`${normalizedDate}T00:00:00.000Z`);
    const exceptions = await this.prisma.professionalAvailabilityException.findMany({
      where: {
        professionalId,
        date: exceptionDate,
      },
    });

    if (exceptions.some((item) => item.isFullDay)) {
      return [];
    }

    const blockedRanges = exceptions
      .filter((item) => !item.isFullDay && item.startTime && item.endTime)
      .map((item) => ({
        startMinutes: parseTimeToMinutes(item.startTime as string),
        endMinutes: parseTimeToMinutes(item.endTime as string),
      }));

    const boundaries = this.buildSlotBoundaries(normalizedDate, tz, offering.durationMinutes);
    const now = new Date();

    const activeBookings = await this.prisma.booking.findMany({
      where: buildActiveBookingOverlapWhere(
        professionalId,
        boundaries.dayStart,
        boundaries.dayEnd,
        now,
      ),
      select: {
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    const slots: Array<{ startAt: string; endAt: string; timezone: string }> = [];

    for (const rule of rules) {
      const ruleStart = parseTimeToMinutes(rule.startTime);
      const ruleEnd = parseTimeToMinutes(rule.endTime);

      for (
        let slotStartMinutes = ruleStart;
        slotStartMinutes + offering.durationMinutes <= ruleEnd;
        slotStartMinutes += offering.durationMinutes
      ) {
        const slotEndMinutes = slotStartMinutes + offering.durationMinutes;

        const blockedByException = blockedRanges.some((range) =>
          intervalsOverlap(slotStartMinutes, slotEndMinutes, range.startMinutes, range.endMinutes),
        );

        if (blockedByException) continue;

        const startAt = zonedDateTimeToUtc(normalizedDate, minutesToTime(slotStartMinutes), tz);
        const endAt = new Date(startAt.getTime() + offering.durationMinutes * 60 * 1000);

        if (startAt <= now) continue;

        const blockedByBooking = activeBookings.some((booking) =>
          startAt < booking.scheduledEndAt && endAt > booking.scheduledStartAt,
        );

        if (blockedByBooking) continue;

        slots.push({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          timezone: tz,
        });
      }
    }

    return slots;
  }

  async createBooking(clientId: string, dto: CreateBookingDto) {
    const timezone = ensureValidTimeZone(dto.timezone ?? DEFAULT_BOOKING_TIMEZONE);
    const scheduledStartAt = new Date(dto.scheduledStartAt);

    if (Number.isNaN(scheduledStartAt.getTime())) {
      throw new BadRequestException('scheduledStartAt invalido.');
    }

    if (dto.professionalId === clientId) {
      throw new BadRequestException('No puedes reservar una sesion contigo mismo.');
    }

    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, role: true, billingRegion: true, phoneCountryIso: true, firstName: true, lastName: true },
    });

    if (!client) throw new NotFoundException('Cliente no encontrado.');

    if (client.role !== UserRole.USER) {
      throw new ForbiddenException('Solo clientes pueden crear reservas.');
    }

    await this.ensureProfessionalExists(dto.professionalId);

    const sessionOffering = await this.prisma.professionalSessionOffering.findFirst({
      where: {
        id: dto.sessionOfferingId,
        professionalId: dto.professionalId,
        isActive: true,
      },
    });

    if (!sessionOffering) {
      throw new NotFoundException('Sesion ofrecida no encontrada o inactiva.');
    }

    const bobToUsdRate = await this.getBobToUsdRate();
    const bookingPriceUsd = Math.round((Number(sessionOffering.priceBob) / bobToUsdRate) * 100) / 100;

    const scheduledEndAt = new Date(
      scheduledStartAt.getTime() + sessionOffering.durationMinutes * 60 * 1000,
    );

    const region = this.normalizeBookingRegion(client);
    const isUsd = region.currency === CURRENCY_USD;
    const chargeAmount = isUsd ? new Prisma.Decimal(bookingPriceUsd) : sessionOffering.priceBob;

    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.expirePendingBookings(tx);

        await this.assertSlotIsBookable(tx, {
          professionalId: dto.professionalId,
          sessionOfferingId: dto.sessionOfferingId,
          scheduledStartAt,
          scheduledEndAt,
          durationMinutes: sessionOffering.durationMinutes,
          timeZone: timezone,
        });

        const clientWallet = await tx.wallet.upsert({
          where: { userId: clientId },
          create: { userId: clientId, balance: 0, promotionalBalance: 0, balanceUsd: 0 },
          update: {},
        });

        let breakdown: ReturnType<typeof allocateCreditDebit> | null = null;

        if (isUsd) {
          if (Number(clientWallet.balanceUsd ?? 0) < Number(chargeAmount)) {
            throw new BadRequestException('Saldo insuficiente para reservar esta sesion.');
          }
        } else {
          try {
            breakdown = allocateCreditDebit(
              Number(clientWallet.balance),
              Number(clientWallet.promotionalBalance),
              Number(chargeAmount),
            );
          } catch {
            throw new BadRequestException('Saldo insuficiente para reservar esta sesion.');
          }
        }

        const booking = await tx.booking.create({
          data: {
            clientId,
            professionalId: dto.professionalId,
            sessionOfferingId: dto.sessionOfferingId,
            scheduledStartAt,
            scheduledEndAt,
            timezone,
            status: BookingStatus.CONFIRMED,
            paymentStatus: BookingPaymentStatus.PAID,
            paymentMethod: BookingPaymentMethod.WALLET,
            currency: region.currency,
            priceBob: sessionOffering.priceBob,
            priceUsd: new Prisma.Decimal(bookingPriceUsd),
            expiresAt: null,
          },
        });

        await tx.bookingPayment.create({
          data: {
            bookingId: booking.id,
            method: BookingPaymentMethod.WALLET,
            status: BookingPaymentStatus.PAID,
            amountBob: isUsd ? null : sessionOffering.priceBob,
            amountUsd: isUsd ? new Prisma.Decimal(bookingPriceUsd) : null,
            currency: region.currency,
          },
        });

        if (isUsd) {
          await tx.wallet.update({
            where: { id: clientWallet.id },
            data: { balanceUsd: { decrement: chargeAmount } },
          });
        } else {
          await tx.wallet.update({
            where: { id: clientWallet.id },
            data: {
              balance: { decrement: chargeAmount },
              promotionalBalance: { decrement: new Prisma.Decimal(breakdown!.promotionalDebited) },
            },
          });
        }

        await tx.transaction.create({
          data: {
            walletId: clientWallet.id,
            type: TransactionType.BOOKING_PAYMENT,
            amount: chargeAmount,
            promotionalAmount: isUsd
              ? new Prisma.Decimal(0)
              : new Prisma.Decimal(breakdown!.promotionalDebited),
            realAmount: isUsd
              ? chargeAmount
              : new Prisma.Decimal(breakdown!.realDebited),
            isPromotional: false,
            description: JSON.stringify({
              event: 'BOOKING_PAYMENT',
              bookingId: booking.id,
              professionalId: dto.professionalId,
              sessionOfferingId: dto.sessionOfferingId,
              currency: region.currency,
            }),
          },
        });

        return booking;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Pasos post-transacción: no deben fallar el endpoint, el booking ya está confirmado y pagado
    this.bookingEarningsService.creditProfessionalEarningForBooking({
      bookingId: result.id,
      source: 'WALLET_PAYMENT',
    }).catch((err) => {
      this.logger.error(`[BOOKING-WALLET] earning credit failed bookingId=${result.id} err=${err?.message}`);
    });

    this.prisma.user.findUnique({
      where: { id: dto.professionalId },
      select: { fcmToken: true },
    }).then((professional) => {
      if (!professional?.fcmToken) return;
      const clientName = this.fullName(client);
      const scheduled = this.formatBookingDateTime(result.scheduledStartAt, result.timezone);
      return this.notificationsService.sendPushNotification(
        professional.fcmToken,
        'Nueva sesion reservada',
        `${clientName} reservo ${sessionOffering.title} para ${scheduled}.`,
        { type: 'BOOKING_PURCHASE_CONFIRMED', bookingId: result.id },
      );
    }).catch((err) => {
      this.logger.error(`[BOOKING-WALLET] notification failed bookingId=${result.id} err=${err?.message}`);
    });

    return {
      ...result,
      priceBob: Number(result.priceBob),
      priceUsd: Number(result.priceUsd),
    };
  }

  async initBookingPayment(clientId: string, bookingId: string) {
    const reqId = this.newReqId();
    this.logger.log(`[BOOKING-PAY][${reqId}] init bookingId=${bookingId} clientId=${clientId}`);

    const initPayload = await this.prisma.$transaction(
      async (tx) => {
        await this.expirePendingBookings(tx);

        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          select: {
            id: true,
            clientId: true,
            professionalId: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            currency: true,
            priceBob: true,
            priceUsd: true,
            expiresAt: true,
          },
        });

        if (!booking) throw new NotFoundException('Booking no encontrado.');
        if (booking.clientId !== clientId) {
          throw new ForbiddenException('No puedes pagar una reserva de otro cliente.');
        }

        if (booking.status === BookingStatus.CONFIRMED || booking.paymentStatus === BookingPaymentStatus.PAID) {
          throw new BadRequestException('La reserva ya se encuentra pagada y confirmada.');
        }

        if (booking.status === BookingStatus.EXPIRED || booking.paymentStatus === BookingPaymentStatus.EXPIRED) {
          throw new BadRequestException('La reserva ya expiro.');
        }

        if (booking.status !== BookingStatus.PENDING_PAYMENT) {
          throw new BadRequestException(
            `No se puede iniciar pago para booking en estado ${booking.status}.`,
          );
        }

        if (booking.paymentStatus !== BookingPaymentStatus.PENDING) {
          throw new BadRequestException(
            `No se puede iniciar pago para booking con paymentStatus ${booking.paymentStatus}.`,
          );
        }

        if (booking.expiresAt && booking.expiresAt <= new Date()) {
          await this.markBookingAsExpired(tx, booking.id);
          throw new BadRequestException('La reserva expiro. Debes crear una nueva reserva.');
        }

        this.validateBookingPaymentMethodAndCurrency({
          paymentMethod: booking.paymentMethod,
          currency: booking.currency,
        });

        const bookingPayment = await this.ensurePendingBookingPaymentRecord(tx, {
          id: booking.id,
          paymentMethod: booking.paymentMethod as BookingPaymentMethod,
          currency: booking.currency,
          priceBob: booking.priceBob,
          priceUsd: booking.priceUsd,
        });

        return {
          bookingId: booking.id,
          professionalId: booking.professionalId,
          paymentMethod: booking.paymentMethod as BookingPaymentMethod,
          currency: booking.currency,
          amountBob: Number(booking.priceBob),
          amountUsd: Number(booking.priceUsd),
          expiresAt: booking.expiresAt,
          bookingPaymentId: bookingPayment.id,
          existingProviderReference: bookingPayment.providerReference,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.logger.log(
      `[BOOKING-PAY][${reqId}] routing bookingId=${initPayload.bookingId} method=${initPayload.paymentMethod} currency=${initPayload.currency} amount=${initPayload.currency === CURRENCY_BOB ? initPayload.amountBob : initPayload.amountUsd}`,
    );

    if (initPayload.paymentMethod === BookingPaymentMethod.BANECO_QR) {
      const result = await this.banecoQrService.createQrForBookingPayment({
        bookingId: initPayload.bookingId,
        bookingPaymentId: initPayload.bookingPaymentId,
        amountBob: initPayload.amountBob,
        currency: CURRENCY_BOB,
        bookingExpiresAt: initPayload.expiresAt,
        requestId: reqId,
      });

      this.logger.log(
        `[BOOKING-PAY][${reqId}] qr_ready bookingId=${initPayload.bookingId} providerReference=${result.providerReference}`,
      );
      return result;
    }

    if (initPayload.paymentMethod === BookingPaymentMethod.STRIPE) {
      const result = await this.stripeService.createPaymentIntentForBooking({
        clientUserId: clientId,
        bookingId: initPayload.bookingId,
        bookingPaymentId: initPayload.bookingPaymentId,
        professionalId: initPayload.professionalId,
        amountUsd: initPayload.amountUsd,
        amountBob: initPayload.amountBob,
        existingPaymentIntentId: initPayload.existingProviderReference,
        requestId: reqId,
      });

      this.logger.log(
        `[BOOKING-PAY][${reqId}] stripe_ready bookingId=${initPayload.bookingId} amount=${initPayload.amountUsd} currency=USD`,
      );
      return result;
    }

    throw new BadRequestException('Metodo de pago de booking no soportado.');
  }

  async getMyBookingById(clientId: string, bookingId: string) {
    await this.expirePendingBookings();

    const item = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        clientId,
      },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: {
              select: { username: true, avatarUrl: true },
            },
          },
        },
        sessionOffering: {
          select: {
            id: true,
            title: true,
            durationMinutes: true,
          },
        },
      },
    });

    if (!item) throw new NotFoundException('Booking no encontrado.');

    return {
      ...item,
      priceBob: Number(item.priceBob),
      priceUsd: Number(item.priceUsd),
    };
  }

  async getMyBookings(clientId: string, query: BookingListQueryDto) {
    await this.expirePendingBookings();

    const rows = await this.prisma.booking.findMany({
      where: {
        clientId,
        ...this.getDateRangeFilter(query),
      },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: {
              select: { username: true, avatarUrl: true },
            },
          },
        },
        sessionOffering: {
          select: {
            id: true,
            title: true,
            durationMinutes: true,
          },
        },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });

    return rows.map((item) => ({
      ...item,
      priceBob: Number(item.priceBob),
      priceUsd: Number(item.priceUsd),
    }));
  }

  async getProfessionalBookings(professionalId: string, query: BookingListQueryDto) {
    await this.expirePendingBookings();

    const rows = await this.prisma.booking.findMany({
      where: {
        professionalId,
        ...this.getDateRangeFilter(query),
      },
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
          },
        },
        sessionOffering: {
          select: {
            id: true,
            title: true,
            durationMinutes: true,
          },
        },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });

    return rows.map((item) => ({
      ...item,
      priceBob: Number(item.priceBob),
      priceUsd: Number(item.priceUsd),
    }));
  }

  async createBatchBookings(clientId: string, dtos: CreateBookingDto[]) {
    if (dtos.length === 0 || dtos.length > 3) {
      throw new BadRequestException('Debes reservar entre 1 y 3 sesiones.');
    }

    for (const dto of dtos) {
      if (dto.professionalId === clientId) {
        throw new BadRequestException('No puedes reservar una sesion contigo mismo.');
      }
      if (Number.isNaN(new Date(dto.scheduledStartAt).getTime())) {
        throw new BadRequestException('scheduledStartAt invalido.');
      }
    }

    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, role: true, billingRegion: true, phoneCountryIso: true, firstName: true, lastName: true },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado.');
    if (client.role !== UserRole.USER) {
      throw new ForbiddenException('Solo clientes pueden crear reservas.');
    }

    const uniqueProfIds = [...new Set(dtos.map((d) => d.professionalId))];
    for (const profId of uniqueProfIds) {
      await this.ensureProfessionalExists(profId);
    }

    const bobToUsdRate = await this.getBobToUsdRate();
    const region = this.normalizeBookingRegion(client);
    const isUsd = region.currency === CURRENCY_USD;

    const batchItems = await Promise.all(
      dtos.map(async (dto) => {
        const timezone = ensureValidTimeZone(dto.timezone ?? DEFAULT_BOOKING_TIMEZONE);
        const offering = await this.prisma.professionalSessionOffering.findFirst({
          where: { id: dto.sessionOfferingId, professionalId: dto.professionalId, isActive: true },
        });
        if (!offering) throw new NotFoundException('Sesion ofrecida no encontrada o inactiva.');
        const priceUsd = Math.round((Number(offering.priceBob) / bobToUsdRate) * 100) / 100;
        const scheduledStartAt = new Date(dto.scheduledStartAt);
        const scheduledEndAt = new Date(scheduledStartAt.getTime() + offering.durationMinutes * 60 * 1000);
        const chargeAmount = isUsd ? new Prisma.Decimal(priceUsd) : offering.priceBob;
        return { dto, timezone, offering, scheduledStartAt, scheduledEndAt, chargeAmount, priceUsd };
      }),
    );

    const slotKeys = batchItems.map((item) => item.dto.scheduledStartAt);
    if (new Set(slotKeys).size !== slotKeys.length) {
      throw new BadRequestException('No puedes reservar el mismo horario dos veces.');
    }

    const results = await this.prisma.$transaction(
      async (tx) => {
        await this.expirePendingBookings(tx);

        for (const item of batchItems) {
          await this.assertSlotIsBookable(tx, {
            professionalId: item.dto.professionalId,
            sessionOfferingId: item.dto.sessionOfferingId,
            scheduledStartAt: item.scheduledStartAt,
            scheduledEndAt: item.scheduledEndAt,
            durationMinutes: item.offering.durationMinutes,
            timeZone: item.timezone,
          });
        }

        for (let i = 0; i < batchItems.length; i++) {
          for (let j = i + 1; j < batchItems.length; j++) {
            const a = batchItems[i];
            const b = batchItems[j];
            if (a.dto.professionalId === b.dto.professionalId) {
              const overlaps = a.scheduledStartAt < b.scheduledEndAt && b.scheduledStartAt < a.scheduledEndAt;
              if (overlaps) {
                throw new BadRequestException('Dos de las sesiones seleccionadas se solapan en horario.');
              }
            }
          }
        }

        const clientWallet = await tx.wallet.upsert({
          where: { userId: clientId },
          create: { userId: clientId, balance: 0, promotionalBalance: 0, balanceUsd: 0 },
          update: {},
        });

        let runningBalance = Number(clientWallet.balance);
        let runningPromo = Number(clientWallet.promotionalBalance);
        const breakdowns: Array<ReturnType<typeof allocateCreditDebit> | null> = [];

        if (isUsd) {
          const totalUsd = batchItems.reduce((sum, item) => sum + Number(item.chargeAmount), 0);
          if (Number(clientWallet.balanceUsd ?? 0) < totalUsd) {
            throw new BadRequestException(
              `Saldo insuficiente para reservar ${dtos.length} sesion${dtos.length > 1 ? 'es' : ''}.`,
            );
          }
          batchItems.forEach(() => breakdowns.push(null));
        } else {
          for (const item of batchItems) {
            let bd: ReturnType<typeof allocateCreditDebit>;
            try {
              bd = allocateCreditDebit(runningBalance, runningPromo, Number(item.chargeAmount));
            } catch {
              throw new BadRequestException(
                `Saldo insuficiente para reservar ${dtos.length} sesion${dtos.length > 1 ? 'es' : ''}.`,
              );
            }
            runningBalance -= Number(item.chargeAmount);
            runningPromo -= bd.promotionalDebited;
            breakdowns.push(bd);
          }
        }

        const bookings: Booking[] = [];
        for (let i = 0; i < batchItems.length; i++) {
          const item = batchItems[i];
          const booking = await tx.booking.create({
            data: {
              clientId,
              professionalId: item.dto.professionalId,
              sessionOfferingId: item.dto.sessionOfferingId,
              scheduledStartAt: item.scheduledStartAt,
              scheduledEndAt: item.scheduledEndAt,
              timezone: item.timezone,
              status: BookingStatus.CONFIRMED,
              paymentStatus: BookingPaymentStatus.PAID,
              paymentMethod: BookingPaymentMethod.WALLET,
              currency: region.currency,
              priceBob: item.offering.priceBob,
              priceUsd: new Prisma.Decimal(item.priceUsd),
              expiresAt: null,
            },
          });

          await tx.bookingPayment.create({
            data: {
              bookingId: booking.id,
              method: BookingPaymentMethod.WALLET,
              status: BookingPaymentStatus.PAID,
              amountBob: isUsd ? null : item.offering.priceBob,
              amountUsd: isUsd ? new Prisma.Decimal(item.priceUsd) : null,
              currency: region.currency,
            },
          });

          bookings.push(booking);
        }

        const totalBobCharge = batchItems.reduce(
          (acc, item) => acc.add(item.chargeAmount),
          new Prisma.Decimal(0),
        );
        const totalPromoDebited = breakdowns.reduce((sum, bd) => sum + (bd?.promotionalDebited ?? 0), 0);
        const totalRealDebited = breakdowns.reduce((sum, bd) => sum + (bd?.realDebited ?? 0), 0);

        await tx.transaction.create({
          data: {
            walletId: clientWallet.id,
            type: TransactionType.BOOKING_PAYMENT,
            amount: totalBobCharge,
            promotionalAmount: isUsd ? new Prisma.Decimal(0) : new Prisma.Decimal(totalPromoDebited),
            realAmount: isUsd ? totalBobCharge : new Prisma.Decimal(totalRealDebited),
            isPromotional: false,
            description: JSON.stringify({
              event: 'BATCH_BOOKING_PAYMENT',
              bookingIds: bookings.map((b) => b.id),
              currency: region.currency,
            }),
          },
        });

        if (isUsd) {
          await tx.wallet.update({
            where: { id: clientWallet.id },
            data: { balanceUsd: { decrement: totalBobCharge } },
          });
        } else {
          await tx.wallet.update({
            where: { id: clientWallet.id },
            data: {
              balance: { decrement: totalBobCharge },
              promotionalBalance: { decrement: new Prisma.Decimal(totalPromoDebited) },
            },
          });
        }

        return bookings;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    );

    // Sequential to avoid deadlock when crediting the same professional wallet multiple times
    void results.reduce(
      (chain, booking) =>
        chain
          .then(() =>
            this.bookingEarningsService.creditProfessionalEarningForBooking({
              bookingId: booking.id,
              source: 'WALLET_PAYMENT',
            }),
          )
          .catch((err: any) => {
            this.logger.error(`[BATCH-BOOKING] earning credit failed bookingId=${booking.id} err=${err?.message}`);
          }),
      Promise.resolve() as Promise<unknown>,
    );

    const notifMap = new Map<string, string[]>();
    for (let i = 0; i < results.length; i++) {
      const profId = batchItems[i].dto.professionalId;
      if (!notifMap.has(profId)) notifMap.set(profId, []);
      notifMap.get(profId)!.push(results[i].id);
    }

    const clientName = this.fullName(client);
    for (const [profId, bookingIds] of notifMap) {
      const count = bookingIds.length;
      this.prisma.user.findUnique({ where: { id: profId }, select: { fcmToken: true } })
        .then((professional) => {
          if (!professional?.fcmToken) return;
          return this.notificationsService.sendPushNotification(
            professional.fcmToken,
            `${count} sesion${count > 1 ? 'es' : ''} reservada${count > 1 ? 's' : ''}`,
            `${clientName} reservo ${count} sesion${count > 1 ? 'es' : ''}.`,
            { type: 'BATCH_BOOKING_CONFIRMED', bookingIds: bookingIds.join(',') },
          );
        })
        .catch((err) => {
          this.logger.error(`[BATCH-BOOKING] notification failed profId=${profId} err=${err?.message}`);
        });
    }

    return {
      bookings: results.map((b) => ({
        ...b,
        priceBob: Number(b.priceBob),
        priceUsd: Number(b.priceUsd),
      })),
    };
  }
}

