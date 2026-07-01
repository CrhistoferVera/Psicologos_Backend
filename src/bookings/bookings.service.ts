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
  BookingRescheduleRequestStatus,
  BookingPaymentMethod,
  BookingPaymentStatus,
  BookingStatus,
  NoShowType,
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
import { SetImmediateAvailabilityDto } from './dto/set-immediate-availability.dto';
import { CreateImmediateBookingDto } from './dto/create-immediate-booking.dto';
import { BookingListQueryDto } from './dto/booking-list-query.dto';
import { BookingRescheduleListQueryDto } from './dto/booking-reschedule-list-query.dto';
import { CreateBookingRescheduleRequestDto } from './dto/create-booking-reschedule-request.dto';
import { RespondBookingRescheduleRequestDto } from './dto/respond-booking-reschedule-request.dto';
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
  clientJoinedAt: Date | null;
  professionalJoinedAt: Date | null;
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private static readonly HARD_FALLBACK_BOB_TO_USD_RATE = 6.96;
  private static readonly MIN_RESCHEDULE_NOTICE_HOURS = 24;

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
      clientJoinedAt: result.clientJoinedAt ? result.clientJoinedAt.toISOString() : null,
      professionalJoinedAt: result.professionalJoinedAt ? result.professionalJoinedAt.toISOString() : null,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
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
        clientJoinedAt: true,
        professionalJoinedAt: true,
      },
    });

    if (activePaidBooking) {
      return {
        allowed: true,
        bookingId: activePaidBooking.id,
        reason: null,
        sessionStartsAt: activePaidBooking.scheduledStartAt,
        sessionEndsAt: activePaidBooking.scheduledEndAt,
        clientJoinedAt: activePaidBooking.clientJoinedAt,
        professionalJoinedAt: activePaidBooking.professionalJoinedAt,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
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
        clientJoinedAt: null,
        professionalJoinedAt: null,
      };
    }

    return {
      allowed: false,
      bookingId: null,
      reason: 'NO_CONFIRMED_BOOKING',
      sessionStartsAt: null,
      sessionEndsAt: null,
      clientJoinedAt: null,
      professionalJoinedAt: null,
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
    const base = this.mapAccessResultForResponse(result);

    let hasReview = false;
    let noShowType: string | null = null;
    let refundWindowExpiresAt: string | null = null;

    if (result.bookingId && result.reason === 'SESSION_ENDED') {
      const [review, noShowBooking] = await Promise.all([
        this.prisma.bookingReview.findUnique({
          where: { bookingId: result.bookingId },
          select: { id: true },
        }),
        this.prisma.booking.findUnique({
          where: { id: result.bookingId },
          select: { noShowType: true, refundWindowExpiresAt: true },
        }),
      ]);
      hasReview = !!review;
      if (noShowBooking?.noShowType) noShowType = noShowBooking.noShowType;
      if (noShowBooking?.refundWindowExpiresAt) {
        refundWindowExpiresAt = noShowBooking.refundWindowExpiresAt.toISOString();
      }
    }

    // También buscar bookings NO_SHOW recientes entre este par (el cron los marca como NO_SHOW)
    if (!noShowType) {
      const pair = this.resolveCommunicationPair(
        { id: currentUserId, role: (await this.prisma.user.findUnique({ where: { id: currentUserId }, select: { role: true } }))?.role ?? 'USER' as any },
        { id: otherUserId, role: (await this.prisma.user.findUnique({ where: { id: otherUserId }, select: { role: true } }))?.role ?? 'USER' as any },
      );
      if (pair) {
        const recentNoShow = await this.prisma.booking.findFirst({
          where: {
            clientId: pair.clientId,
            professionalId: pair.professionalId,
            status: BookingStatus.NO_SHOW,
            noShowType: 'PROFESSIONAL',
            refundWindowExpiresAt: { gt: new Date() },
          },
          orderBy: { scheduledStartAt: 'desc' },
          select: { id: true, noShowType: true, refundWindowExpiresAt: true },
        });
        if (recentNoShow) {
          noShowType = recentNoShow.noShowType;
          refundWindowExpiresAt = recentNoShow.refundWindowExpiresAt?.toISOString() ?? null;
        }
      }
    }

    return { ...base, hasReview, noShowType, refundWindowExpiresAt };
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

  /**
   * Descuenta la contribución del wallet del cliente al confirmar un pago externo (QR/Stripe).
   * walletContrib = booking.priceBob - bookingPayment.amountBob (la diferencia ya pagada externamente).
   * Se llama dentro de la transacción del webhook, después de marcar el booking como CONFIRMED.
   */
  async deductWalletContributionOnExternalPayment(
    tx: PrismaTx,
    booking: { id: string; clientId: string; currency: string; priceBob: any; priceUsd: any },
    bookingPayment: { amountBob: any; amountUsd: any },
  ) {
    const isUsd = booking.currency === CURRENCY_USD;
    const fullPrice = isUsd ? Number(booking.priceUsd) : Number(booking.priceBob);
    const externalAmount = isUsd ? Number(bookingPayment.amountUsd ?? 0) : Number(bookingPayment.amountBob ?? 0);
    const walletContrib = Math.round((fullPrice - externalAmount) * 100) / 100;

    if (walletContrib <= 0.001) return; // sin contribución del wallet

    const clientWallet = await tx.wallet.findUnique({ where: { userId: booking.clientId } });
    if (!clientWallet) return;

    if (isUsd) {
      const available = Number(clientWallet.balanceUsd ?? 0);
      const toDeduct = Math.min(walletContrib, available);
      if (toDeduct <= 0.001) return;
      await tx.wallet.update({
        where: { id: clientWallet.id },
        data: { balanceUsd: { decrement: new Prisma.Decimal(toDeduct) } },
      });
      await tx.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: TransactionType.BOOKING_PAYMENT,
          amount: new Prisma.Decimal(toDeduct),
          promotionalAmount: new Prisma.Decimal(0),
          realAmount: new Prisma.Decimal(toDeduct),
          isPromotional: false,
          description: JSON.stringify({
            event: 'BOOKING_WALLET_CONTRIBUTION_ON_EXTERNAL_PAYMENT',
            bookingId: booking.id,
            currency: booking.currency,
          }),
        },
      });
    } else {
      const available = Number(clientWallet.balance ?? 0);
      const toDeduct = Math.min(walletContrib, available);
      if (toDeduct <= 0.001) return;
      let promoDebited = 0;
      let realDebited = toDeduct;
      try {
        const bd = allocateCreditDebit(available, Number(clientWallet.promotionalBalance ?? 0), toDeduct);
        promoDebited = bd.promotionalDebited;
        realDebited = bd.realDebited;
      } catch { /* usa toDeduct completo como real */ }
      await tx.wallet.update({
        where: { id: clientWallet.id },
        data: {
          balance: { decrement: new Prisma.Decimal(realDebited) },
          promotionalBalance: { decrement: new Prisma.Decimal(promoDebited) },
        },
      });
      await tx.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: TransactionType.BOOKING_PAYMENT,
          amount: new Prisma.Decimal(toDeduct),
          promotionalAmount: new Prisma.Decimal(promoDebited),
          realAmount: new Prisma.Decimal(realDebited),
          isPromotional: false,
          description: JSON.stringify({
            event: 'BOOKING_WALLET_CONTRIBUTION_ON_EXTERNAL_PAYMENT',
            bookingId: booking.id,
            currency: booking.currency,
          }),
        },
      });
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

    // Si ya existe un registro PENDING (creado en createBatchBookings con el monto externo correcto),
    // NO sobreescribir los amounts — preservar el monto externo (ej. 90 BOB).
    if (pending) {
      return pending;
    }

    // Solo crear si no existe (booking creado por flujo antiguo sin monto externo previo)
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
      excludeBookingId?: string;
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
        payload.excludeBookingId,
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

    if (!dto.priceBob && !dto.priceUsd) {
      throw new BadRequestException('Debes indicar priceBob o priceUsd.');
    }

    const rate = await this.getBobToUsdRate();

    let finalPriceBob: number;
    let finalPriceUsd: number;

    if (dto.priceUsd) {
      finalPriceUsd = dto.priceUsd;
      finalPriceBob = Math.round(dto.priceUsd * rate * 100) / 100;
    } else {
      finalPriceBob = dto.priceBob!;
      finalPriceUsd = Math.round((dto.priceBob! / rate) * 100) / 100;
    }

    const created = await this.prisma.professionalSessionOffering.create({
      data: {
        professionalId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        durationMinutes: dto.durationMinutes,
        priceBob: new Prisma.Decimal(finalPriceBob),
        priceUsd: new Prisma.Decimal(finalPriceUsd),
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

    if (dto.priceUsd !== undefined) {
      if (dto.priceUsd <= 0) throw new BadRequestException('priceUsd debe ser mayor que 0.');
      payload.priceUsd = new Prisma.Decimal(dto.priceUsd);
      payload.priceBob = new Prisma.Decimal(Math.round(dto.priceUsd * bobToUsdRate * 100) / 100);
    } else if (dto.priceBob !== undefined) {
      if (dto.priceBob <= 0) throw new BadRequestException('priceBob debe ser mayor que 0.');
      payload.priceBob = new Prisma.Decimal(dto.priceBob);
      payload.priceUsd = new Prisma.Decimal(Math.round((dto.priceBob / bobToUsdRate) * 100) / 100);
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

        const bookingPrices = {
          priceBob: sessionOffering.priceBob,
          priceUsd: new Prisma.Decimal(bookingPriceUsd),
          originalPriceBob: sessionOffering.priceBob,
          originalPriceUsd: new Prisma.Decimal(bookingPriceUsd),
        };

        const chargeAmount = isUsd ? bookingPrices.priceUsd : bookingPrices.priceBob;

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
            priceBob: bookingPrices.priceBob,
            priceUsd: bookingPrices.priceUsd,
            originalPriceBob: bookingPrices.originalPriceBob,
            originalPriceUsd: bookingPrices.originalPriceUsd,
            expiresAt: null,
          },
        });

        await tx.bookingPayment.create({
          data: {
            bookingId: booking.id,
            method: BookingPaymentMethod.WALLET,
            status: BookingPaymentStatus.PAID,
            amountBob: isUsd ? null : bookingPrices.priceBob,
            amountUsd: isUsd ? bookingPrices.priceUsd : null,
            originalAmountBob: isUsd ? null : bookingPrices.originalPriceBob,
            originalAmountUsd: isUsd ? bookingPrices.originalPriceUsd : null,
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

  async initBookingPayment(clientId: string, bookingId: string, batchBookingIds?: string[]) {
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

        // Calcular monto total del batch si se pasaron más bookingIds
        // Ejemplo: 2 sesiones de 100 BOB, wallet 10 BOB → totalExternal = 90 + 100 = 190 BOB
        let totalAmountBob = Number(bookingPayment.amountBob ?? booking.priceBob);
        let totalAmountUsd = Number(bookingPayment.amountUsd ?? booking.priceUsd);
        const coveredBookingIds: string[] = [];
        const coveredBookingPaymentIds: string[] = [];

        if (batchBookingIds && batchBookingIds.length > 0) {
          const otherIds = batchBookingIds.filter((id) => id !== bookingId);
          for (const otherId of otherIds) {
            const otherBooking = await tx.booking.findUnique({
              where: { id: otherId },
              select: { id: true, clientId: true, status: true, paymentStatus: true, currency: true, priceBob: true, priceUsd: true },
            });
            if (!otherBooking || otherBooking.clientId !== clientId) continue;
            if (otherBooking.status !== BookingStatus.PENDING_PAYMENT) continue;

            const otherPayment = await tx.bookingPayment.findFirst({
              where: { bookingId: otherId, status: BookingPaymentStatus.PENDING },
              orderBy: { createdAt: 'desc' },
            });
            if (!otherPayment) continue;

            if (booking.currency === CURRENCY_BOB) {
              totalAmountBob += Number(otherPayment.amountBob ?? otherBooking.priceBob);
            } else {
              totalAmountUsd += Number(otherPayment.amountUsd ?? otherBooking.priceUsd);
            }
            coveredBookingIds.push(otherId);
            coveredBookingPaymentIds.push(otherPayment.id);
          }
        }

        // NO actualizamos bookingPayment.amountBob/Usd con el total del batch.
        // Cada booking ya tiene su monto externo individual correcto desde createBatchBookings.
        // Sobreescribir acumularía el total en cada llamada a initBookingPayment (bug).

        return {
          bookingId: booking.id,
          professionalId: booking.professionalId,
          paymentMethod: booking.paymentMethod as BookingPaymentMethod,
          currency: booking.currency,
          amountBob: totalAmountBob,
          amountUsd: totalAmountUsd,
          expiresAt: booking.expiresAt,
          bookingPaymentId: bookingPayment.id,
          existingProviderReference: bookingPayment.providerReference,
          coveredBookingIds,
          coveredBookingPaymentIds,
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
        coveredBookingIds: initPayload.coveredBookingIds,
        coveredBookingPaymentIds: initPayload.coveredBookingPaymentIds,
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
        coveredBookingIds: initPayload.coveredBookingIds,
        coveredBookingPaymentIds: initPayload.coveredBookingPaymentIds,
        requestId: reqId,
      });

      this.logger.log(
        `[BOOKING-PAY][${reqId}] stripe_ready bookingId=${initPayload.bookingId} amount=${initPayload.amountUsd} currency=USD`,
      );
      return result;
    }

    throw new BadRequestException('Metodo de pago de booking no soportado.');
  }

  private normalizeRescheduleActorRole(role: UserRole | string): UserRole {
    const normalized = String(role) as UserRole;
    if (normalized === UserRole.USER || this.isProfessionalRole(normalized)) {
      return normalized;
    }
    throw new ForbiddenException('No tienes permisos para gestionar reprogramaciones.');
  }

  private assertUserIsBookingParticipant(
    booking: { clientId: string; professionalId: string },
    userId: string,
  ) {
    if (booking.clientId !== userId && booking.professionalId !== userId) {
      throw new ForbiddenException('No tienes permisos sobre esta reserva.');
    }
  }

  private assertBookingIsReschedulable(
    booking: {
      status: BookingStatus;
      paymentStatus: BookingPaymentStatus;
      scheduledStartAt: Date;
      scheduledEndAt: Date;
    },
    now = new Date(),
  ) {
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Solo se pueden reprogramar reservas confirmadas.');
    }

    if (booking.paymentStatus !== BookingPaymentStatus.PAID) {
      throw new BadRequestException('Solo se pueden reprogramar reservas pagadas.');
    }

    if (booking.scheduledEndAt <= now || booking.scheduledStartAt <= now) {
      throw new BadRequestException('No se puede reprogramar una reserva que ya inicio o finalizo.');
    }
  }

  private assertRescheduleNoticeWindow(startAt: Date, now = new Date()) {
    const minAllowedAt = new Date(
      now.getTime() + BookingsService.MIN_RESCHEDULE_NOTICE_HOURS * 60 * 60 * 1000,
    );
    if (startAt <= minAllowedAt) {
      throw new BadRequestException(
        'La cita solo puede reprogramarse con al menos 24 horas de anticipacion.',
      );
    }
  }

  private getBookingDurationMinutes(booking: { scheduledStartAt: Date; scheduledEndAt: Date }) {
    const durationMs = booking.scheduledEndAt.getTime() - booking.scheduledStartAt.getTime();
    if (durationMs <= 0) {
      throw new BadRequestException('La reserva tiene una duracion invalida.');
    }

    return Math.round(durationMs / (60 * 1000));
  }

  private getRescheduleCounterpartUserId(
    booking: { clientId: string; professionalId: string },
    requesterUserId: string,
  ) {
    return booking.clientId === requesterUserId ? booking.professionalId : booking.clientId;
  }

  private async expireOverdueRescheduleRequests(tx: PrismaTx, bookingId?: string) {
    const now = new Date();
    await tx.bookingRescheduleRequest.updateMany({
      where: {
        status: BookingRescheduleRequestStatus.PENDING,
        requestExpiresAt: { not: null, lt: now },
        ...(bookingId ? { bookingId } : {}),
      },
      data: {
        status: BookingRescheduleRequestStatus.EXPIRED,
        respondedAt: now,
      },
    });
  }

  private assertCounterpartCanRespond(
    booking: { clientId: string; professionalId: string },
    request: { requestedByUserId: string },
    responderUserId: string,
  ) {
    if (request.requestedByUserId === responderUserId) {
      throw new ForbiddenException('El solicitante no puede responder su propia solicitud.');
    }

    const counterpartUserId = this.getRescheduleCounterpartUserId(booking, request.requestedByUserId);
    if (counterpartUserId !== responderUserId) {
      throw new ForbiddenException('Solo la contraparte puede responder esta solicitud.');
    }
  }

  async createRescheduleRequest(
    bookingId: string,
    requestedByUserId: string,
    requestedByRole: UserRole | string,
    dto: CreateBookingRescheduleRequestDto,
  ) {
    await this.expirePendingBookings();
    const actorRole = this.normalizeRescheduleActorRole(requestedByRole);
    const proposedStartAt = new Date(dto.proposedStartAt);
    if (Number.isNaN(proposedStartAt.getTime())) {
      throw new BadRequestException('proposedStartAt invalido.');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        sessionOfferingId: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        timezone: true,
        status: true,
        paymentStatus: true,
        rescheduleCount: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking no encontrado.');
    }

    const now = new Date();
    this.assertUserIsBookingParticipant(booking, requestedByUserId);
    this.assertBookingIsReschedulable(booking, now);
    this.assertRescheduleNoticeWindow(booking.scheduledStartAt, now);

    if (actorRole === UserRole.USER && booking.clientId !== requestedByUserId) {
      throw new ForbiddenException('Solo el cliente de la reserva puede solicitar como usuario.');
    }

    if (this.isProfessionalRole(actorRole) && booking.professionalId !== requestedByUserId) {
      throw new ForbiddenException('Solo el profesional de la reserva puede solicitar como profesional.');
    }

    this.assertRescheduleNoticeWindow(proposedStartAt, now);

    if (proposedStartAt.getTime() === booking.scheduledStartAt.getTime()) {
      throw new BadRequestException('La fecha propuesta debe ser distinta al horario actual.');
    }

    const maxReschedules = 2;
    if (booking.rescheduleCount >= maxReschedules) {
      throw new BadRequestException(`La reserva alcanzo el maximo de ${maxReschedules} reprogramaciones.`);
    }

    const proposedTimezone = ensureValidTimeZone(dto.proposedTimezone ?? booking.timezone);
    const durationMinutes = this.getBookingDurationMinutes(booking);
    const proposedEndAt = new Date(proposedStartAt.getTime() + durationMinutes * 60 * 1000);

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.expireOverdueRescheduleRequests(tx, booking.id);

        const pendingForBooking = await tx.bookingRescheduleRequest.findFirst({
          where: {
            bookingId: booking.id,
            status: BookingRescheduleRequestStatus.PENDING,
          },
          select: { id: true },
        });

        if (pendingForBooking) {
          throw new BadRequestException(
            'Ya existe una solicitud de reprogramacion pendiente para esta reserva.',
          );
        }

        await this.assertSlotIsBookable(tx, {
          professionalId: booking.professionalId,
          sessionOfferingId: booking.sessionOfferingId,
          scheduledStartAt: proposedStartAt,
          scheduledEndAt: proposedEndAt,
          durationMinutes,
          timeZone: proposedTimezone,
          excludeBookingId: booking.id,
        });

        return tx.bookingRescheduleRequest.create({
          data: {
            bookingId: booking.id,
            requestedByUserId,
            requestedByRole: actorRole,
            currentStartAt: booking.scheduledStartAt,
            currentEndAt: booking.scheduledEndAt,
            proposedStartAt,
            proposedEndAt,
            proposedTimezone,
            reason: dto.reason?.trim() || null,
            status: BookingRescheduleRequestStatus.PENDING,
            requestExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
          include: {
            requestedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
            respondedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return created;
  }

  async acceptRescheduleRequest(
    requestId: string,
    respondedByUserId: string,
    respondedByRole: UserRole | string,
    dto: RespondBookingRescheduleRequestDto,
  ) {
    await this.expirePendingBookings();
    this.normalizeRescheduleActorRole(respondedByRole);

    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.expireOverdueRescheduleRequests(tx);

        const request = await tx.bookingRescheduleRequest.findUnique({
          where: { id: requestId },
          include: {
            booking: {
              select: {
                id: true,
                clientId: true,
                professionalId: true,
                sessionOfferingId: true,
                status: true,
                paymentStatus: true,
                scheduledStartAt: true,
                scheduledEndAt: true,
                timezone: true,
                rescheduleCount: true,
              },
            },
          },
        });

        if (!request) {
          throw new NotFoundException('Solicitud de reprogramacion no encontrada.');
        }

        this.assertUserIsBookingParticipant(request.booking, respondedByUserId);
        this.assertCounterpartCanRespond(request.booking, request, respondedByUserId);

        if (request.status !== BookingRescheduleRequestStatus.PENDING) {
          throw new BadRequestException('La solicitud no esta pendiente.');
        }

        if (request.requestExpiresAt && request.requestExpiresAt <= now) {
          await tx.bookingRescheduleRequest.update({
            where: { id: request.id },
            data: {
              status: BookingRescheduleRequestStatus.EXPIRED,
              respondedAt: now,
            },
          });
          throw new BadRequestException('La solicitud ya expiro.');
        }

        this.assertBookingIsReschedulable(request.booking, now);
        this.assertRescheduleNoticeWindow(request.booking.scheduledStartAt, now);
        this.assertRescheduleNoticeWindow(request.proposedStartAt, now);

        const durationMinutes = this.getBookingDurationMinutes({
          scheduledStartAt: request.currentStartAt,
          scheduledEndAt: request.currentEndAt,
        });

        await this.assertSlotIsBookable(tx, {
          professionalId: request.booking.professionalId,
          sessionOfferingId: request.booking.sessionOfferingId,
          scheduledStartAt: request.proposedStartAt,
          scheduledEndAt: request.proposedEndAt,
          durationMinutes,
          timeZone: request.proposedTimezone,
          excludeBookingId: request.booking.id,
        });

        await tx.booking.update({
          where: { id: request.bookingId },
          data: {
            scheduledStartAt: request.proposedStartAt,
            scheduledEndAt: request.proposedEndAt,
            timezone: request.proposedTimezone,
            rescheduleCount: { increment: 1 },
            reminder15SentAt: null,
            reminder10BeforeStartSentAt: null,
            reminder15BeforeEndSentAt: null,
          },
        });

        const updatedRequest = await tx.bookingRescheduleRequest.update({
          where: { id: request.id },
          data: {
            status: BookingRescheduleRequestStatus.ACCEPTED,
            respondedByUserId,
            respondedAt: now,
            responseNote: dto.responseNote?.trim() || null,
          },
          include: {
            booking: {
              select: {
                id: true,
                clientId: true,
                professionalId: true,
                scheduledStartAt: true,
                scheduledEndAt: true,
                timezone: true,
                status: true,
                paymentStatus: true,
                rescheduleCount: true,
              },
            },
            requestedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
            respondedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        });

        await tx.bookingRescheduleRequest.updateMany({
          where: {
            bookingId: request.bookingId,
            id: { not: request.id },
            status: BookingRescheduleRequestStatus.PENDING,
          },
          data: {
            status: BookingRescheduleRequestStatus.EXPIRED,
            respondedAt: now,
          },
        });

        return updatedRequest;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return result;
  }

  async rejectRescheduleRequest(
    requestId: string,
    respondedByUserId: string,
    respondedByRole: UserRole | string,
    dto: RespondBookingRescheduleRequestDto,
  ) {
    await this.expirePendingBookings();
    this.normalizeRescheduleActorRole(respondedByRole);

    return this.prisma.$transaction(
      async (tx) => {
        await this.expireOverdueRescheduleRequests(tx);

        const request = await tx.bookingRescheduleRequest.findUnique({
          where: { id: requestId },
          include: {
            booking: {
              select: {
                id: true,
                clientId: true,
                professionalId: true,
              },
            },
          },
        });

        if (!request) {
          throw new NotFoundException('Solicitud de reprogramacion no encontrada.');
        }

        this.assertUserIsBookingParticipant(request.booking, respondedByUserId);
        this.assertCounterpartCanRespond(request.booking, request, respondedByUserId);

        if (request.status !== BookingRescheduleRequestStatus.PENDING) {
          throw new BadRequestException('La solicitud no esta pendiente.');
        }

        const now = new Date();
        return tx.bookingRescheduleRequest.update({
          where: { id: request.id },
          data: {
            status: BookingRescheduleRequestStatus.REJECTED,
            respondedByUserId,
            respondedAt: now,
            responseNote: dto.responseNote?.trim() || null,
          },
          include: {
            requestedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
            respondedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async cancelRescheduleRequest(requestId: string, requestedByUserId: string, requestedByRole: UserRole | string) {
    await this.expirePendingBookings();
    this.normalizeRescheduleActorRole(requestedByRole);

    return this.prisma.$transaction(
      async (tx) => {
        await this.expireOverdueRescheduleRequests(tx);

        const request = await tx.bookingRescheduleRequest.findUnique({
          where: { id: requestId },
          include: {
            booking: {
              select: {
                id: true,
                clientId: true,
                professionalId: true,
              },
            },
          },
        });

        if (!request) {
          throw new NotFoundException('Solicitud de reprogramacion no encontrada.');
        }

        this.assertUserIsBookingParticipant(request.booking, requestedByUserId);

        if (request.requestedByUserId !== requestedByUserId) {
          throw new ForbiddenException('Solo el solicitante puede cancelar la solicitud.');
        }

        if (request.status !== BookingRescheduleRequestStatus.PENDING) {
          throw new BadRequestException('La solicitud no esta pendiente.');
        }

        return tx.bookingRescheduleRequest.update({
          where: { id: request.id },
          data: {
            status: BookingRescheduleRequestStatus.CANCELLED,
            respondedByUserId: requestedByUserId,
            respondedAt: new Date(),
          },
          include: {
            requestedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
            respondedByUser: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listMyRescheduleRequests(userId: string, role: UserRole | string, query: BookingRescheduleListQueryDto) {
    await this.expirePendingBookings();
    const normalizedRole = this.normalizeRescheduleActorRole(role);
    await this.expireOverdueRescheduleRequests(this.prisma);

    const isProfessional = this.isProfessionalRole(normalizedRole);
    const where: Prisma.BookingRescheduleRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      booking: isProfessional ? { is: { professionalId: userId } } : { is: { clientId: userId } },
    };

    return this.prisma.bookingRescheduleRequest.findMany({
      where,
      include: {
        booking: {
          select: {
            id: true,
            clientId: true,
            professionalId: true,
            scheduledStartAt: true,
            scheduledEndAt: true,
            timezone: true,
            status: true,
            paymentStatus: true,
            rescheduleCount: true,
          },
        },
        requestedByUser: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondedByUser: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listBookingRescheduleRequests(bookingId: string, userId: string, role: UserRole | string) {
    await this.expirePendingBookings();
    this.normalizeRescheduleActorRole(role);
    await this.expireOverdueRescheduleRequests(this.prisma, bookingId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking no encontrado.');
    }

    this.assertUserIsBookingParticipant(booking, userId);

    return this.prisma.bookingRescheduleRequest.findMany({
      where: { bookingId },
      include: {
        requestedByUser: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        respondedByUser: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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

  async getProfessionalBookings(professionalId: string, _query: BookingListQueryDto) {
    await this.expirePendingBookings();

    const rows = await this.prisma.booking.findMany({
      where: {
        professionalId,
        status: { not: BookingStatus.PENDING_PAYMENT },
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

        // ── Calcular contribución del wallet y monto externo por sesión ─────────────
        // walletContrib = lo que cubre el wallet (puede ser parcial o total)
        // externalAmount = lo que falta pagar por QR (BOB) o Stripe (USD)
        // El wallet se descuenta inmediatamente; el externo espera al webhook.
        type ItemBreakdown = {
          walletContrib: Prisma.Decimal;
          externalAmount: Prisma.Decimal;
          promoDebited: number;
          realDebited: number;
          needsExternalPayment: boolean;
        };

        const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1000; // 15 minutos

        // Mínimos de pago externo por proveedor
        // Stripe rechaza cobros < $0.50 USD; Baneco QR rechaza < 1 BOB
        const MIN_STRIPE_USD = 0.50;
        const MIN_BANECO_BOB = 1.00;

        const itemBreakdowns: ItemBreakdown[] = [];

        if (isUsd) {
          let runningUsd = Number(clientWallet.balanceUsd ?? 0);
          for (const item of batchItems) {
            const price = Number(item.chargeAmount);
            let walletContrib = Math.min(runningUsd, price);
            let external = Math.round((price - walletContrib) * 100) / 100;

            // Si el monto externo es menor al mínimo de Stripe pero mayor que cero,
            // intentar absorberlo con el wallet. Si no alcanza, elevar al mínimo.
            if (external > 0 && external < MIN_STRIPE_USD) {
              const canAbsorb = runningUsd >= price;
              if (canAbsorb) {
                // Wallet cubre el todo — pago full wallet
                walletContrib = price;
                external = 0;
              } else {
                // Elevar monto externo al mínimo de Stripe, reducir walletContrib
                external = MIN_STRIPE_USD;
                walletContrib = Math.round((price - external) * 100) / 100;
              }
            }

            runningUsd -= walletContrib;
            itemBreakdowns.push({
              walletContrib: new Prisma.Decimal(walletContrib),
              externalAmount: new Prisma.Decimal(external),
              promoDebited: 0,
              realDebited: walletContrib,
              needsExternalPayment: external >= MIN_STRIPE_USD,
            });
          }
        } else {
          let runningBalance = Number(clientWallet.balance);
          let runningPromo = Number(clientWallet.promotionalBalance);
          for (const item of batchItems) {
            const price = Number(item.chargeAmount);
            let walletContrib = Math.min(runningBalance, price);
            let external = Math.round((price - walletContrib) * 100) / 100;

            // Si el monto externo es menor al mínimo de Baneco QR pero mayor que cero,
            // intentar absorberlo con el wallet. Si no alcanza, elevar al mínimo.
            if (external > 0 && external < MIN_BANECO_BOB) {
              const canAbsorb = runningBalance >= price;
              if (canAbsorb) {
                walletContrib = price;
                external = 0;
              } else {
                external = MIN_BANECO_BOB;
                walletContrib = Math.round((price - external) * 100) / 100;
              }
            }

            let promoDebited = 0;
            let realDebited = walletContrib;
            if (walletContrib > 0) {
              try {
                const bd = allocateCreditDebit(runningBalance, runningPromo, walletContrib);
                promoDebited = bd.promotionalDebited;
                realDebited = bd.realDebited;
              } catch { /* walletContrib ajustado puede ser 0 */ }
            }
            runningBalance -= realDebited;
            runningPromo = Math.max(0, runningPromo - promoDebited);
            itemBreakdowns.push({
              walletContrib: new Prisma.Decimal(walletContrib),
              externalAmount: new Prisma.Decimal(external),
              promoDebited,
              realDebited,
              needsExternalPayment: external >= MIN_BANECO_BOB,
            });
          }
        }

        // ── Crear bookings y BookingPayments ────────────────────────────────────────
        const bookings: Booking[] = [];
        const expiresAt = new Date(Date.now() + PENDING_PAYMENT_TTL_MS);

        for (let i = 0; i < batchItems.length; i++) {
          const item = batchItems[i];
          const bd = itemBreakdowns[i];
          const needsExternal = bd.needsExternalPayment;

          // Si falta pago externo: QR para Bolivia, Stripe para internacional
          const paymentMethod = needsExternal
            ? (isUsd ? BookingPaymentMethod.STRIPE : BookingPaymentMethod.BANECO_QR)
            : BookingPaymentMethod.WALLET;

          const booking = await tx.booking.create({
            data: {
              clientId,
              professionalId: item.dto.professionalId,
              sessionOfferingId: item.dto.sessionOfferingId,
              scheduledStartAt: item.scheduledStartAt,
              scheduledEndAt: item.scheduledEndAt,
              timezone: item.timezone,
              status: needsExternal ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
              paymentStatus: needsExternal ? BookingPaymentStatus.PENDING : BookingPaymentStatus.PAID,
              paymentMethod,
              currency: region.currency,
              priceBob: item.offering.priceBob,
              priceUsd: new Prisma.Decimal(item.priceUsd),
              expiresAt: needsExternal ? expiresAt : null,
            },
          });

          // amountBob/Usd = monto externo (lo que pagará QR o Stripe)
          // Si es pago full wallet: amountBob/Usd = precio completo
          await tx.bookingPayment.create({
            data: {
              bookingId: booking.id,
              method: paymentMethod,
              status: needsExternal ? BookingPaymentStatus.PENDING : BookingPaymentStatus.PAID,
              amountBob: isUsd ? null : (needsExternal ? bd.externalAmount : item.offering.priceBob),
              amountUsd: isUsd ? (needsExternal ? bd.externalAmount : new Prisma.Decimal(item.priceUsd)) : null,
              currency: region.currency,
            },
          });

          bookings.push(booking);
        }

        // ── Descontar wallet SOLO para los bookings ya CONFIRMED (pago full wallet) ──
        // Los PENDING_PAYMENT NO tocan el wallet ahora.
        // El webhook de QR/Stripe descuenta la contribución del wallet al confirmar.
        const confirmedBreakdowns = itemBreakdowns.filter((_, i) => !itemBreakdowns[i].needsExternalPayment);
        const totalWalletContrib = confirmedBreakdowns.reduce(
          (acc, bd) => acc.add(bd.walletContrib),
          new Prisma.Decimal(0),
        );
        const totalPromoDebited = confirmedBreakdowns.reduce((sum, bd) => sum + bd.promoDebited, 0);
        const totalRealDebited = confirmedBreakdowns.reduce((sum, bd) => sum + bd.realDebited, 0);

        if (totalWalletContrib.greaterThan(0)) {
          const confirmedBookingIds = bookings
            .filter((b) => b.status === BookingStatus.CONFIRMED)
            .map((b) => b.id);

          await tx.transaction.create({
            data: {
              walletId: clientWallet.id,
              type: TransactionType.BOOKING_PAYMENT,
              amount: totalWalletContrib,
              promotionalAmount: isUsd ? new Prisma.Decimal(0) : new Prisma.Decimal(totalPromoDebited),
              realAmount: isUsd ? totalWalletContrib : new Prisma.Decimal(totalRealDebited),
              isPromotional: false,
              description: JSON.stringify({
                event: 'BATCH_BOOKING_PAYMENT',
                bookingIds: confirmedBookingIds,
                currency: region.currency,
              }),
            },
          });

          if (isUsd) {
            await tx.wallet.update({
              where: { id: clientWallet.id },
              data: { balanceUsd: { decrement: totalWalletContrib } },
            });
          } else {
            await tx.wallet.update({
              where: { id: clientWallet.id },
              data: {
                balance: { decrement: new Prisma.Decimal(totalRealDebited) },
                promotionalBalance: { decrement: new Prisma.Decimal(totalPromoDebited) },
              },
            });
          }
        }

        return bookings;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    );

    // Solo acreditar y notificar los bookings que ya están CONFIRMED (pago full wallet)
    // Los PENDING_PAYMENT se acreditan cuando el webhook de QR o Stripe confirme
    const confirmedResults = results.filter((b) => b.status === BookingStatus.CONFIRMED);
    const pendingResults = results.filter((b) => b.status === BookingStatus.PENDING_PAYMENT);

    if (pendingResults.length > 0) {
      this.logger.log(
        `[BATCH-BOOKING] ${pendingResults.length} booking(s) pendiente(s) de pago externo: ${pendingResults.map((b) => b.id).join(', ')}`,
      );
    }

    // Sequential to avoid deadlock when crediting the same professional wallet multiple times
    void confirmedResults.reduce(
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

    // Notificar al psicólogo solo por bookings ya confirmados
    const notifMap = new Map<string, string[]>();
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== BookingStatus.CONFIRMED) continue;
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

  // ─── ATENCIÓN INMEDIATA ───────────────────────────────────────────────────

  // METODO PARA ACTIVAR O RECONFIGURAR LA ATENCIÓN INMEDIATA DE UN PROFESIONAL
  async activateImmediateAvailability(professionalId: string, dto: SetImmediateAvailabilityDto) {
    await this.ensureProfessionalExists(professionalId);

    if (!dto.priceBob && !dto.priceUsd) {
      throw new BadRequestException('Debes proporcionar priceBob o priceUsd.');
    }

    const expiresAt = new Date(Date.now() + dto.activeForMinutes * 60 * 1000);
    const bobToUsdRate = await this.getBobToUsdRate();
    const priceBob = dto.priceBob ?? Math.round(dto.priceUsd! * bobToUsdRate * 100) / 100;
    const priceUsd = dto.priceUsd ?? Math.round((dto.priceBob! / bobToUsdRate) * 100) / 100;

    // Upsert del registro de disponibilidad inmediata
    const availability = await this.prisma.professionalImmediateAvailability.upsert({
      where: { professionalId },
      create: {
        professionalId,
        isActive: true,
        expiresAt,
        durationMinutes: dto.durationMinutes,
        priceBob,
        description: dto.description,
      },
      update: {
        isActive: true,
        expiresAt,
        durationMinutes: dto.durationMinutes,
        priceBob,
        description: dto.description,
      },
    });

    // Upsert del SessionOffering de atención inmediata
    const existingOffering = await this.prisma.professionalSessionOffering.findFirst({
      where: { professionalId, title: 'Atención Inmediata' },
    });

    if (existingOffering) {
      await this.prisma.professionalSessionOffering.update({
        where: { id: existingOffering.id },
        data: {
          durationMinutes: dto.durationMinutes,
          priceBob,
          priceUsd,
          isActive: true,
        },
      });
    } else {
      await this.prisma.professionalSessionOffering.create({
        data: {
          professionalId,
          title: 'Atención Inmediata',
          description: dto.description,
          durationMinutes: dto.durationMinutes,
          priceBob,
          priceUsd,
        },
      });
    }

    return {
      ...availability,
      priceBob: Number(availability.priceBob),
      expiresAt: availability.expiresAt?.toISOString(),
    };
  }

  // METODO PARA DESACTIVAR LA ATENCIÓN INMEDIATA DE UN PROFESIONAL
  async deactivateImmediateAvailability(professionalId: string) {
    await this.ensureProfessionalExists(professionalId);

    const existing = await this.prisma.professionalImmediateAvailability.findUnique({
      where: { professionalId },
    });

    if (!existing) {
      throw new NotFoundException('No tienes una configuración de atención inmediata.');
    }

    await this.prisma.professionalImmediateAvailability.update({
      where: { professionalId },
      data: { isActive: false, expiresAt: null },
    });

    // Desactiva también el SessionOffering
    await this.prisma.professionalSessionOffering.updateMany({
      where: { professionalId, title: 'Atención Inmediata' },
      data: { isActive: false },
    });

    return { success: true };
  }

  // METODO PARA CONSULTAR EL ESTADO DE LA ATENCIÓN INMEDIATA PROPIA
  async getMyImmediateAvailability(professionalId: string) {
    const record = await this.prisma.professionalImmediateAvailability.findUnique({
      where: { professionalId },
    });

    if (!record) return { isActive: false };

    // Auto-desactivar si expiró
    if (record.isActive && record.expiresAt && record.expiresAt <= new Date()) {
      await this.prisma.professionalImmediateAvailability.update({
        where: { professionalId },
        data: { isActive: false },
      });
      return { isActive: false };
    }

    const priceBob = Number(record.priceBob);
    const bobToUsdRate = await this.getBobToUsdRate();
    const priceUsd = Math.round((priceBob / bobToUsdRate) * 100) / 100;

    return {
      ...record,
      priceBob,
      priceUsd,
      expiresAt: record.expiresAt?.toISOString(),
    };
  }

  // METODO PARA LISTAR PROFESIONALES CON ATENCIÓN INMEDIATA ACTIVA
  async getImmediateProfessionals() {
    const bobToUsdRate = await this.getBobToUsdRate();

    const records = await this.prisma.professionalImmediateAvailability.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: new Date() },
        professional: {
          isActive: true,
          wallet: { is: { isBlocked: false } },
        },
      },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: {
              select: {
                avatarUrl: true,
                bio: true,
              },
            },
            professionalSpecialties: {
              select: { specialty: { select: { name: true } } },
            },
          },
        },
      },
    });

    return records.map((r) => {
      const priceBob = Number(r.priceBob);
      const priceUsd = Math.round((priceBob / bobToUsdRate) * 100) / 100;
      return {
        professionalId: r.professionalId,
        durationMinutes: r.durationMinutes,
        priceBob,
        priceUsd,
        description: r.description,
        expiresAt: r.expiresAt?.toISOString(),
        professional: {
          id: r.professional.id,
          firstName: r.professional.firstName,
          lastName: r.professional.lastName,
          avatarUrl: r.professional.professionalProfile?.avatarUrl ?? null,
          bio: r.professional.professionalProfile?.bio ?? null,
          specialties: r.professional.professionalSpecialties.map((s) => s.specialty.name),
        },
      };
    });
  }

  // METODO PARA CONSULTAR DETALLE DE ATENCIÓN INMEDIATA DE UN PROFESIONAL
  async getProfessionalImmediateDetail(professionalId: string) {
    const record = await this.prisma.professionalImmediateAvailability.findUnique({
      where: { professionalId },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: {
              select: { avatarUrl: true, bio: true },
            },
            professionalSpecialties: {
              select: { specialty: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!record || !record.isActive || (record.expiresAt && record.expiresAt <= new Date())) {
      throw new NotFoundException('Este profesional no tiene atención inmediata disponible.');
    }

    const bobToUsdRate = await this.getBobToUsdRate();
    const priceBob = Number(record.priceBob);
    const priceUsd = Math.round((priceBob / bobToUsdRate) * 100) / 100;

    return {
      professionalId: record.professionalId,
      durationMinutes: record.durationMinutes,
      priceBob,
      priceUsd,
      description: record.description,
      expiresAt: record.expiresAt?.toISOString(),
      professional: {
        id: record.professional.id,
        firstName: record.professional.firstName,
        lastName: record.professional.lastName,
        avatarUrl: record.professional.professionalProfile?.avatarUrl ?? null,
        bio: record.professional.professionalProfile?.bio ?? null,
        specialties: record.professional.professionalSpecialties.map((s) => s.specialty.name),
      },
    };
  }

  // METODO PARA CREAR UN BOOKING DE ATENCIÓN INMEDIATA (RESERVA INSTANTÁNEA)
  // No valida availability rules — el psicólogo activó disponibilidad manualmente.
  async createImmediateBooking(clientId: string, dto: CreateImmediateBookingDto) {
    if (dto.professionalId === clientId) {
      throw new BadRequestException('No puedes reservar una sesión contigo mismo.');
    }

    const availability = await this.prisma.professionalImmediateAvailability.findUnique({
      where: { professionalId: dto.professionalId },
    });
    if (!availability || !availability.isActive || !availability.expiresAt || availability.expiresAt <= new Date()) {
      throw new BadRequestException('Este profesional no tiene atención inmediata disponible en este momento.');
    }

    const offering = await this.prisma.professionalSessionOffering.findFirst({
      where: { professionalId: dto.professionalId, title: 'Atención Inmediata', isActive: true },
    });
    if (!offering) {
      throw new BadRequestException('No se encontró la oferta de atención inmediata del profesional.');
    }

    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, role: true, billingRegion: true, phoneCountryIso: true },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado.');
    if (client.role !== UserRole.USER) throw new ForbiddenException('Solo clientes pueden crear reservas.');

    const bobToUsdRate = await this.getBobToUsdRate();
    const priceUsd = Math.round((Number(offering.priceBob) / bobToUsdRate) * 100) / 100;
    const region = this.normalizeBookingRegion(client);
    const isUsd = region.currency === CURRENCY_USD;
    const paymentMethod = isUsd ? BookingPaymentMethod.STRIPE : BookingPaymentMethod.BANECO_QR;

    const now = new Date();
    const scheduledEndAt = new Date(now.getTime() + offering.durationMinutes * 60 * 1000);
    const PENDING_TTL_MS = 15 * 60 * 1000;

    // Expirar bookings pendientes antes de la transacción para no bloquear el pool
    await this.expirePendingBookings();

    const booking = await this.prisma.$transaction(async (tx) => {
      const record = await tx.booking.create({
        data: {
          clientId,
          professionalId: dto.professionalId,
          sessionOfferingId: offering.id,
          scheduledStartAt: now,
          scheduledEndAt,
          timezone: DEFAULT_BOOKING_TIMEZONE,
          status: BookingStatus.PENDING_PAYMENT,
          paymentStatus: BookingPaymentStatus.PENDING,
          paymentMethod,
          currency: region.currency,
          priceBob: offering.priceBob,
          priceUsd: new Prisma.Decimal(priceUsd),
          originalPriceBob: offering.priceBob,
          originalPriceUsd: new Prisma.Decimal(priceUsd),
          expiresAt: new Date(Date.now() + PENDING_TTL_MS),
        },
      });

      await tx.bookingPayment.create({
        data: {
          bookingId: record.id,
          method: paymentMethod,
          status: BookingPaymentStatus.PENDING,
          amountBob: isUsd ? null : offering.priceBob,
          amountUsd: isUsd ? new Prisma.Decimal(priceUsd) : null,
          originalAmountBob: isUsd ? null : offering.priceBob,
          originalAmountUsd: isUsd ? new Prisma.Decimal(priceUsd) : null,
          currency: region.currency,
        },
      });

      return record;
    });

    const paymentInit = await this.initBookingPayment(clientId, booking.id);

    return {
      booking: { ...booking, priceBob: Number(booking.priceBob), priceUsd: Number(booking.priceUsd) },
      paymentInit,
    };
  }

  async markJoined(bookingId: string, userId: string, role: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        paymentStatus: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
      },
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada.');
    if (booking.status !== BookingStatus.CONFIRMED) throw new BadRequestException('La reserva no está activa.');
    if (booking.paymentStatus !== BookingPaymentStatus.PAID) throw new BadRequestException('La reserva no está pagada.');

    const now = new Date();
    if (now < booking.scheduledStartAt || now > booking.scheduledEndAt) {
      throw new BadRequestException('No estás dentro del horario de la sesión.');
    }

    const isClient = booking.clientId === userId;
    const isProfessional = booking.professionalId === userId;
    if (!isClient && !isProfessional) throw new ForbiddenException('No tienes acceso a esta reserva.');

    if (isClient) {
      await this.prisma.booking.updateMany({
        where: { id: bookingId, clientJoinedAt: null },
        data: { clientJoinedAt: now },
      });
    } else {
      await this.prisma.booking.updateMany({
        where: { id: bookingId, professionalJoinedAt: null },
        data: { professionalJoinedAt: now },
      });
    }

    return { ok: true };
  }

  async reportNoShow(bookingId: string, reporterUserId: string, reporterRole: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        paymentStatus: true,
        scheduledStartAt: true,
        noShowType: true,
        currency: true,
        priceBob: true,
        priceUsd: true,
        client: { select: { fcmToken: true, firstName: true } },
        professional: { select: { fcmToken: true, firstName: true } },
        earning: { select: { professionalAmount: true } },
      },
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada.');

    const isClient = booking.clientId === reporterUserId;
    const isProfessional = booking.professionalId === reporterUserId;

    if (!isClient && !isProfessional) {
      throw new ForbiddenException('No tienes acceso a esta reserva.');
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Solo se puede reportar ausencia en reservas confirmadas.');
    }

    if (booking.paymentStatus !== BookingPaymentStatus.PAID) {
      throw new BadRequestException('La reserva no ha sido pagada.');
    }

    if (booking.noShowType !== null) {
      throw new BadRequestException('Ya se reportó una ausencia para esta reserva.');
    }

    const config = await this.systemConfigService.getRuntimeConfig();

    const graceMs = config.noShowGraceMinutes * 60 * 1000;
    const now = new Date();
    if (now.getTime() < booking.scheduledStartAt.getTime() + graceMs) {
      const minutosRestantes = Math.ceil(
        (booking.scheduledStartAt.getTime() + graceMs - now.getTime()) / 60000,
      );
      throw new BadRequestException(
        `Debes esperar ${minutosRestantes} minuto(s) más antes de reportar ausencia.`,
      );
    }

    if (isClient) {
      // Cliente reporta → el psicólogo no se presentó
      // El timer corre desde el momento del reporte, no desde el fin de la sesión
      const refundWindowMs = Number(config.refundLateWindowMinutes) * 60 * 1000;
      const refundWindowExpiresAt = new Date(now.getTime() + refundWindowMs);

      const isUsd = booking.currency === 'USD';
      const sessionPrice = isUsd
        ? new Prisma.Decimal(booking.priceUsd)
        : new Prisma.Decimal(booking.priceBob);

      // Lo que el psicólogo ya recibió por esta sesión (se revierte, no es multa)
      const earningReversal = booking.earning
        ? new Prisma.Decimal(booking.earning.professionalAmount).toDecimalPlaces(2)
        : new Prisma.Decimal(0);

      // La multa es solo el % del precio bruto de la sesión
      const penaltyPercent = new Prisma.Decimal(config.noShowPenaltyPercent).div(100);
      const penaltyAmount = sessionPrice.mul(penaltyPercent).toDecimalPlaces(2);

      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            status: BookingStatus.NO_SHOW,
            noShowType: 'PROFESSIONAL',
            refundWindowExpiresAt,
          },
        });

        const wallet = await tx.wallet.upsert({
          where: { userId: booking.professionalId },
          create: { userId: booking.professionalId },
          update: {},
        });

        const currentBalance = isUsd
          ? new Prisma.Decimal(wallet.balanceUsd)
          : new Prisma.Decimal(wallet.balance);

        // Paso 1: revertir el earning sin generar deuda (se descuenta del saldo disponible)
        const balanceAfterReversal = currentBalance.greaterThanOrEqualTo(earningReversal)
          ? currentBalance.minus(earningReversal)
          : new Prisma.Decimal(0);

        // Paso 2: aplicar la multa sobre el saldo restante — esta sí puede generar deuda
        if (balanceAfterReversal.greaterThanOrEqualTo(penaltyAmount)) {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: isUsd
              ? { balanceUsd: balanceAfterReversal.minus(penaltyAmount) }
              : { balance: balanceAfterReversal.minus(penaltyAmount) },
          });
        } else {
          const debtAmount = penaltyAmount.minus(balanceAfterReversal).toDecimalPlaces(2);
          await tx.wallet.update({
            where: { id: wallet.id },
            data: isUsd
              ? { balanceUsd: new Prisma.Decimal(0), debtUsd: { increment: debtAmount }, isBlocked: true }
              : { balance: new Prisma.Decimal(0), debtBob: { increment: debtAmount }, isBlocked: true },
          });
        }

        // Liberar el lock del BookingEarning — el earning fue revertido, no debe contar como bloqueado
        await tx.bookingEarning.updateMany({
          where: { bookingId },
          data: { availableForWithdrawalAt: new Date(0) },
        });

        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.PENALTY,
            amount: penaltyAmount,
            promotionalAmount: new Prisma.Decimal(0),
            realAmount: penaltyAmount,
            description: JSON.stringify({
              event: 'NO_SHOW_PENALTY',
              bookingId,
              currency: booking.currency,
              earningReversal: Number(earningReversal),
              penaltyPercent: Number(config.noShowPenaltyPercent),
              penaltyAmount: Number(penaltyAmount),
              totalDeduction: Number(earningReversal.plus(penaltyAmount)),
            }),
          },
        });
      });

      // Notificar al cliente que puede pedir reembolso
      if (booking.client.fcmToken) {
        this.notificationsService.sendPushNotification(
          booking.client.fcmToken,
          'Reembolso disponible',
          `Tu psicólogo no se presentó. Puedes solicitar tu reembolso hasta las ${refundWindowExpiresAt.toLocaleTimeString()}.`,
          { type: 'NO_SHOW_REFUND_AVAILABLE', bookingId },
        );
      }

      // Notificar al psicólogo de la deducción total
      if (booking.professional.fcmToken) {
        this.notificationsService.sendPushNotification(
          booking.professional.fcmToken,
          'No asististe a una sesión',
          `Se dedujo ${earningReversal.plus(penaltyAmount).toFixed(2)} ${booking.currency} de tu cuenta (ganancia devuelta + multa por no presentarte).`,
          { type: 'NO_SHOW_PENALTY', bookingId },
        );
      }

      return { noShowType: 'PROFESSIONAL', refundWindowExpiresAt };
    }

    if (isProfessional) {
      // Psicólogo reporta → el cliente no se presentó → acreditar al psicólogo
      await this.bookingEarningsService.creditProfessionalEarningForBooking({
        bookingId,
        source: 'NO_SHOW_CLIENT',
      });

      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.NO_SHOW,
          noShowType: 'CLIENT',
        },
      });

      // Notificar al psicólogo que recibirá su pago
      if (booking.professional.fcmToken) {
        this.notificationsService.sendPushNotification(
          booking.professional.fcmToken,
          'Cliente no asistió',
          'El cliente no se presentó. Recibirás el pago de tu sesión.',
          { type: 'NO_SHOW_CLIENT_PROFESSIONAL_PAID', bookingId },
        );
      }

      // Notificar al cliente que no habrá reembolso
      if (booking.client.fcmToken) {
        this.notificationsService.sendPushNotification(
          booking.client.fcmToken,
          'Sesión no realizada',
          'No asististe a tu sesión. El psicólogo recibirá su pago ya que sí estuvo disponible.',
          { type: 'NO_SHOW_CLIENT_NO_REFUND', bookingId },
        );
      }

      return { noShowType: 'CLIENT' };
    }
  }

  async requestRefund(bookingId: string, clientId: string, clientPayoutAccountId: string) {
    const now = new Date();

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        noShowType: true,
        currency: true,
        priceBob: true,
        priceUsd: true,
        scheduledStartAt: true,
        refundWindowExpiresAt: true,
        refundRequest: { select: { id: true } },
        professional: { select: { fcmToken: true, firstName: true, lastName: true } },
      },
    });

    if (!booking) throw new NotFoundException('Booking no encontrado.');
    if (booking.clientId !== clientId) throw new ForbiddenException('No tienes permisos sobre esta reserva.');

    if (booking.noShowType !== 'PROFESSIONAL' && booking.noShowType !== 'BOTH') {
      throw new BadRequestException('El reembolso solo aplica cuando el psicólogo no se presentó.');
    }

    if (!booking.refundWindowExpiresAt || now > booking.refundWindowExpiresAt) {
      throw new BadRequestException('La ventana para solicitar reembolso ha expirado.');
    }

    if (booking.refundRequest) {
      throw new BadRequestException('Ya existe una solicitud de reembolso para esta reserva.');
    }

    const payoutAccount = await this.prisma.clientPayoutAccount.findUnique({
      where: { id: clientPayoutAccountId },
      select: { id: true, clientId: true },
    });

    if (!payoutAccount || payoutAccount.clientId !== clientId) {
      throw new NotFoundException('Cuenta de pago no encontrada.');
    }

    const config = await this.systemConfigService.getRuntimeConfig();
    const minutesElapsed = (now.getTime() - booking.scheduledStartAt.getTime()) / 60000;

    let refundPercent: number;
    if (minutesElapsed <= config.refundEarlyWindowMinutes) {
      refundPercent = config.refundEarlyPercent;
    } else {
      refundPercent = config.refundLatePercent;
    }

    const percentDecimal = new Prisma.Decimal(refundPercent).div(100);
    const amountBob = new Prisma.Decimal(booking.priceBob).mul(percentDecimal).toDecimalPlaces(2);
    const amountUsd = new Prisma.Decimal(booking.priceUsd).mul(percentDecimal).toDecimalPlaces(2);

    const refundRequest = await this.prisma.refundRequest.create({
      data: {
        bookingId,
        clientId,
        clientPayoutAccountId,
        amountBob,
        amountUsd,
        percentage: refundPercent,
        status: 'PENDING',
        requestedAt: now,
      },
    });

    // Notificar al admin si existe algún usuario con rol ADMIN que tenga fcmToken
    this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { fcmToken: true },
    }).then((admins) => {
      for (const admin of admins) {
        if (!admin.fcmToken) continue;
        this.notificationsService.sendPushNotification(
          admin.fcmToken,
          'Nueva solicitud de reembolso',
          `Un cliente solicitó un reembolso del ${refundPercent}% (${Number(booking.currency === 'USD' ? amountUsd : amountBob).toFixed(2)} ${booking.currency}).`,
          { type: 'REFUND_REQUEST_PENDING', refundRequestId: refundRequest.id, bookingId },
        );
      }
    }).catch((err) => {
      this.logger.error(`[REFUND-REQUEST] admin notification failed refundRequestId=${refundRequest.id} err=${err?.message}`);
    });

    return {
      id: refundRequest.id,
      bookingId,
      amountBob: Number(amountBob),
      amountUsd: Number(amountUsd),
      percentage: refundPercent,
      status: refundRequest.status,
      requestedAt: refundRequest.requestedAt,
    };
  }

  async autoDetectBothNoShows() {
    const config = await this.systemConfigService.getRuntimeConfig();
    const now = new Date();
    const refundWindowMs = Number(config.refundLateWindowMinutes) * 60 * 1000;
    const lookbackCutoff = new Date(now.getTime() - refundWindowMs);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        noShowType: null,
        professionalJoinedAt: null,
        clientJoinedAt: null,
        scheduledEndAt: { lt: now, gte: lookbackCutoff },
      },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        currency: true,
        priceBob: true,
        priceUsd: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        earning: { select: { professionalAmount: true } },
        client: { select: { fcmToken: true } },
        professional: { select: { fcmToken: true } },
      },
    });

    for (const booking of bookings) {
      try {
        const refundWindowExpiresAt = new Date(booking.scheduledEndAt.getTime() + refundWindowMs);
        const isUsd = booking.currency === 'USD';

        const earningReversal = booking.earning
          ? new Prisma.Decimal(booking.earning.professionalAmount).toDecimalPlaces(2)
          : new Prisma.Decimal(0);

        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: BookingStatus.NO_SHOW,
              noShowType: 'BOTH',
              refundWindowExpiresAt,
            },
          });

          if (earningReversal.greaterThan(0)) {
            const wallet = await tx.wallet.upsert({
              where: { userId: booking.professionalId },
              create: { userId: booking.professionalId },
              update: {},
            });

            const currentBalance = isUsd
              ? new Prisma.Decimal(wallet.balanceUsd)
              : new Prisma.Decimal(wallet.balance);

            if (currentBalance.greaterThanOrEqualTo(earningReversal)) {
              await tx.wallet.update({
                where: { id: wallet.id },
                data: isUsd
                  ? { balanceUsd: { decrement: earningReversal } }
                  : { balance: { decrement: earningReversal } },
              });
            } else {
              const debtAmount = earningReversal.minus(currentBalance).toDecimalPlaces(2);
              await tx.wallet.update({
                where: { id: wallet.id },
                data: isUsd
                  ? { balanceUsd: new Prisma.Decimal(0), debtUsd: { increment: debtAmount }, isBlocked: true }
                  : { balance: new Prisma.Decimal(0), debtBob: { increment: debtAmount }, isBlocked: true },
              });
            }

            // Liberar el lock del BookingEarning — el earning fue revertido, no debe contar como bloqueado
            await tx.bookingEarning.updateMany({
              where: { bookingId: booking.id },
              data: { availableForWithdrawalAt: new Date(0) },
            });

            await tx.transaction.create({
              data: {
                walletId: wallet.id,
                type: TransactionType.PENALTY,
                amount: earningReversal,
                promotionalAmount: new Prisma.Decimal(0),
                realAmount: earningReversal,
                description: JSON.stringify({
                  event: 'NO_SHOW_BOTH_EARNING_REVERSAL',
                  bookingId: booking.id,
                  currency: booking.currency,
                  earningReversal: Number(earningReversal),
                }),
              },
            });
          }
        });

        if (booking.client.fcmToken) {
          this.notificationsService.sendPushNotification(
            booking.client.fcmToken,
            'Ninguno asistió a la sesión',
            `Tienes hasta ${refundWindowExpiresAt.toLocaleDateString('es-BO')} para solicitar tu reembolso.`,
            { type: 'NO_SHOW_REFUND_AVAILABLE', bookingId: booking.id },
          );
        }

        if (booking.professional.fcmToken) {
          this.notificationsService.sendPushNotification(
            booking.professional.fcmToken,
            'Ninguno asistió a la sesión',
            `No se registró tu ingreso ni el del cliente. Tu ganancia fue revertida.`,
            { type: 'NO_SHOW_BOTH', bookingId: booking.id },
          );
        }

        this.logger.log(`[NO_SHOW_AUTO_BOTH] bookingId=${booking.id} earningReversal=${Number(earningReversal)}`);
      } catch (err: any) {
        this.logger.error(`[NO_SHOW_AUTO_BOTH] bookingId=${booking.id} error=${err?.message}`);
      }
    }
  }

  async autoDetectClientNoShows() {
    const config = await this.systemConfigService.getRuntimeConfig();
    const now = new Date();
    const refundWindowMs = Number(config.refundLateWindowMinutes) * 60 * 1000;
    const lookbackCutoff = new Date(now.getTime() - refundWindowMs);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        noShowType: null,
        clientJoinedAt: null,
        professionalJoinedAt: { not: null },
        scheduledEndAt: { lt: now, gte: lookbackCutoff },
      },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        client: { select: { fcmToken: true } },
        professional: { select: { fcmToken: true } },
      },
    });

    for (const booking of bookings) {
      try {
        await this.bookingEarningsService.creditProfessionalEarningForBooking({
          bookingId: booking.id,
          source: 'NO_SHOW_CLIENT_AUTO',
        });

        await this.prisma.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.NO_SHOW,
            noShowType: 'CLIENT',
          },
        });

        if (booking.professional.fcmToken) {
          this.notificationsService.sendPushNotification(
            booking.professional.fcmToken,
            'Cliente no asistió',
            'El cliente no se presentó. Recibirás el pago de tu sesión.',
            { type: 'NO_SHOW_CLIENT_PROFESSIONAL_PAID', bookingId: booking.id },
          );
        }

        if (booking.client.fcmToken) {
          this.notificationsService.sendPushNotification(
            booking.client.fcmToken,
            'Sesión no realizada',
            'No asististe a tu sesión. El psicólogo recibirá su pago ya que sí estuvo disponible.',
            { type: 'NO_SHOW_CLIENT_NO_REFUND', bookingId: booking.id },
          );
        }

        this.logger.log(`[NO_SHOW_AUTO_CLIENT] bookingId=${booking.id} professionalCredited=true`);
      } catch (err: any) {
        this.logger.error(`[NO_SHOW_AUTO_CLIENT] bookingId=${booking.id} error=${err?.message}`);
      }
    }
  }

  async autoDetectProfessionalNoShows() {
    const config = await this.systemConfigService.getRuntimeConfig();
    const now = new Date();
    const refundWindowMs = Number(config.refundLateWindowMinutes) * 60 * 1000;
    const lookbackCutoff = new Date(now.getTime() - refundWindowMs);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        paymentStatus: BookingPaymentStatus.PAID,
        noShowType: null,
        professionalJoinedAt: null,
        clientJoinedAt: { not: null },
        scheduledEndAt: { lt: now, gte: lookbackCutoff },
      },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        currency: true,
        priceBob: true,
        priceUsd: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        earning: { select: { professionalAmount: true } },
        client: { select: { fcmToken: true } },
        professional: { select: { fcmToken: true } },
      },
    });

    for (const booking of bookings) {
      try {
        const refundWindowExpiresAt = new Date(booking.scheduledEndAt.getTime() + refundWindowMs);
        const isUsd = booking.currency === 'USD';
        const sessionPrice = isUsd
          ? new Prisma.Decimal(booking.priceUsd)
          : new Prisma.Decimal(booking.priceBob);

        const earningReversal = booking.earning
          ? new Prisma.Decimal(booking.earning.professionalAmount).toDecimalPlaces(2)
          : new Prisma.Decimal(0);

        const penaltyPercent = new Prisma.Decimal(config.noShowPenaltyPercent).div(100);
        const penaltyAmount = sessionPrice.mul(penaltyPercent).toDecimalPlaces(2);

        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: BookingStatus.NO_SHOW,
              noShowType: 'PROFESSIONAL',
              refundWindowExpiresAt,
            },
          });

          const wallet = await tx.wallet.upsert({
            where: { userId: booking.professionalId },
            create: { userId: booking.professionalId },
            update: {},
          });

          const currentBalance = isUsd
            ? new Prisma.Decimal(wallet.balanceUsd)
            : new Prisma.Decimal(wallet.balance);

          // Paso 1: revertir el earning sin generar deuda
          const balanceAfterReversal = currentBalance.greaterThanOrEqualTo(earningReversal)
            ? currentBalance.minus(earningReversal)
            : new Prisma.Decimal(0);

          // Paso 2: aplicar la multa sobre el saldo restante — esta sí puede generar deuda
          if (balanceAfterReversal.greaterThanOrEqualTo(penaltyAmount)) {
            await tx.wallet.update({
              where: { id: wallet.id },
              data: isUsd
                ? { balanceUsd: balanceAfterReversal.minus(penaltyAmount) }
                : { balance: balanceAfterReversal.minus(penaltyAmount) },
            });
          } else {
            const debtAmount = penaltyAmount.minus(balanceAfterReversal).toDecimalPlaces(2);
            await tx.wallet.update({
              where: { id: wallet.id },
              data: isUsd
                ? { balanceUsd: new Prisma.Decimal(0), debtUsd: { increment: debtAmount }, isBlocked: true }
                : { balance: new Prisma.Decimal(0), debtBob: { increment: debtAmount }, isBlocked: true },
            });
          }

          // Liberar el lock del BookingEarning — el earning fue revertido, no debe contar como bloqueado
          await tx.bookingEarning.updateMany({
            where: { bookingId: booking.id },
            data: { availableForWithdrawalAt: new Date(0) },
          });

          await tx.transaction.create({
            data: {
              walletId: wallet.id,
              type: TransactionType.PENALTY,
              amount: penaltyAmount,
              promotionalAmount: new Prisma.Decimal(0),
              realAmount: penaltyAmount,
              description: JSON.stringify({
                event: 'NO_SHOW_PENALTY_AUTO',
                bookingId: booking.id,
                currency: booking.currency,
                earningReversal: Number(earningReversal),
                penaltyPercent: Number(config.noShowPenaltyPercent),
                penaltyAmount: Number(penaltyAmount),
                totalDeduction: Number(earningReversal.plus(penaltyAmount)),
              }),
            },
          });
        });

        if (booking.client.fcmToken) {
          this.notificationsService.sendPushNotification(
            booking.client.fcmToken,
            'Tu psicólogo no se presentó',
            `Tienes hasta ${refundWindowExpiresAt.toLocaleDateString('es-BO')} para solicitar tu reembolso.`,
            { type: 'NO_SHOW_REFUND_AVAILABLE', bookingId: booking.id },
          );
        }

        if (booking.professional.fcmToken) {
          this.notificationsService.sendPushNotification(
            booking.professional.fcmToken,
            'No asististe a una sesión',
            `Se aplicó una penalidad de ${earningReversal.plus(penaltyAmount).toFixed(2)} ${booking.currency} por no presentarte.`,
            { type: 'NO_SHOW_PENALTY', bookingId: booking.id },
          );
        }

        this.logger.log(`[NO_SHOW_AUTO] bookingId=${booking.id} penaltyApplied=${Number(earningReversal.plus(penaltyAmount))}`);
      } catch (err: any) {
        this.logger.error(`[NO_SHOW_AUTO] bookingId=${booking.id} error=${err?.message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoDetectNoShowsCron() {
    await this.autoDetectBothNoShows();
    await this.autoDetectClientNoShows();
    await this.autoDetectProfessionalNoShows();
  }

  // CRON PARA EXPIRAR AUTOMÁTICAMENTE LAS DISPONIBILIDADES INMEDIATAS VENCIDAS (POR SI FALLA EL AUTO-DESACTIVO EN CONSULTAS)
  @Cron(CronExpression.EVERY_MINUTE)
  async expireImmediateAvailabilities() {
    await this.prisma.professionalImmediateAvailability.updateMany({
      where: { isActive: true, expiresAt: { lte: new Date() } },
      data: { isActive: false },
    });
  }
}

