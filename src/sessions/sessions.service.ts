import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BanecoQrService } from '../baneco-qr/baneco-qr.service';
import { StripeService } from '../stripe/stripe.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private static readonly HARD_FALLBACK_BOB_TO_USD_RATE = 6.96;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly systemConfigService: SystemConfigService,
    private readonly banecoQrService: BanecoQrService,
    private readonly stripeService: StripeService,
  ) {}

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
      `[FX] Usando fallback duro ${SessionsService.HARD_FALLBACK_BOB_TO_USD_RATE} para BOB→USD.`,
    );
    return SessionsService.HARD_FALLBACK_BOB_TO_USD_RATE;
  }

  private calcPriceInUsd(priceInBs: number, bobToUsdRate: number): number {
    return Math.round((priceInBs / bobToUsdRate) * 100) / 100;
  }

  private formatSession(s: any) {
    const priceInBs = Number(s.priceInBs);
    return {
      id: s.id,
      professionalUserId: s.professionalUserId,
      title: s.title,
      durationMinutes: s.durationMinutes,
      priceInBs,
      priceInUsd: Number(s.priceInUsd),
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      professional: s.professional
        ? {
            id: s.professional.id,
            firstName: s.professional.firstName,
            lastName: s.professional.lastName,
            avatarUrl: s.professional.professionalProfile?.avatarUrl ?? null,
            username: s.professional.professionalProfile?.username ?? null,
          }
        : undefined,
    };
  }

  async createSession(professionalUserId: string, dto: CreateSessionDto) {
    const bobToUsdRate = await this.getBobToUsdRate();
    const priceInUsd = this.calcPriceInUsd(dto.priceInBs, bobToUsdRate);

    const session = await this.prisma.session.create({
      data: {
        professionalUserId,
        title: dto.title,
        durationMinutes: dto.durationMinutes,
        priceInBs: new Prisma.Decimal(dto.priceInBs),
        priceInUsd: new Prisma.Decimal(priceInUsd),
        status: 'OPEN',
      },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
      },
    });

    return this.formatSession(session);
  }

  async updateSession(professionalUserId: string, sessionId: string, dto: UpdateSessionDto) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    if (session.professionalUserId !== professionalUserId) throw new ForbiddenException('No autorizado.');
    if (session.status !== 'OPEN') {
      throw new BadRequestException('Solo se pueden editar sesiones en estado OPEN.');
    }

    const data: Prisma.SessionUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.priceInBs !== undefined) {
      const bobToUsdRate = await this.getBobToUsdRate();
      data.priceInBs = new Prisma.Decimal(dto.priceInBs);
      data.priceInUsd = new Prisma.Decimal(this.calcPriceInUsd(dto.priceInBs, bobToUsdRate));
    }

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data,
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
      },
    });

    return this.formatSession(updated);
  }

  async cancelSession(professionalUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    if (session.professionalUserId !== professionalUserId) throw new ForbiddenException('No autorizado.');
    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      throw new BadRequestException('Esta sesion ya fue finalizada o cancelada.');
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED' },
    });

    return { message: 'Sesion cancelada.' };
  }

  async startSession(professionalUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    if (session.professionalUserId !== professionalUserId) throw new ForbiddenException('No autorizado.');
    if (session.status !== 'OPEN') {
      throw new BadRequestException('Solo se pueden iniciar sesiones en estado OPEN.');
    }

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });

    return this.formatSession(updated);
  }

  async endSession(professionalUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    if (session.professionalUserId !== professionalUserId) throw new ForbiddenException('No autorizado.');
    if (session.status !== 'ACTIVE') {
      throw new BadRequestException('Solo se pueden terminar sesiones ACTIVE.');
    }

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    return this.formatSession(updated);
  }

  async getMySessions(professionalUserId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { professionalUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
        payments: { select: { id: true, clientUserId: true, status: true, currency: true } },
      },
    });

    return sessions.map((s) => ({
      ...this.formatSession(s),
      paymentsCount: s.payments.length,
      approvedCount: s.payments.filter((p) => p.status === 'APPROVED').length,
    }));
  }

  async getOpenSessions() {
    const sessions = await this.prisma.session.findMany({
      where: { status: { in: ['OPEN', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true, bio: true } },
            professionalSpecialties: {
              take: 3,
              include: { specialty: { select: { name: true } } },
            },
          },
        },
      },
    });

    return sessions.map((s) => ({
      ...this.formatSession(s),
      professional: s.professional ? {
        id: s.professional.id,
        firstName: s.professional.firstName,
        lastName: s.professional.lastName,
        avatarUrl: s.professional.professionalProfile?.avatarUrl ?? null,
        username: s.professional.professionalProfile?.username ?? null,
        bio: s.professional.professionalProfile?.bio ?? null,
        specialties: s.professional.professionalSpecialties.map((ps) => ps.specialty.name),
      } : undefined,
    }));
  }

  async getSessionById(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    return this.formatSession(session);
  }

  async getSessionAccess(clientUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        professional: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            professionalProfile: { select: { avatarUrl: true, username: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sesion no encontrada.');

    const isProfessional = session.professionalUserId === clientUserId;

    if (!isProfessional) {
      const payment = await this.prisma.sessionPayment.findUnique({
        where: { sessionId_clientUserId: { sessionId, clientUserId } },
      });
      if (!payment || payment.status !== 'APPROVED') {
        throw new ForbiddenException('Debes pagar la sesion para poder acceder.');
      }
    }

    if (session.status === 'CANCELLED') throw new BadRequestException('Esta sesion fue cancelada.');
    if (session.status === 'COMPLETED') throw new BadRequestException('Esta sesion ya finalizo.');

    const otherUserId = isProfessional ? null : session.professionalUserId;
    let conversationId: string | null = null;

    if (!isProfessional && otherUserId) {
      const [u1, u2] = [clientUserId, otherUserId].sort();
      const conv = await this.prisma.conversation.upsert({
        where: { user1Id_user2Id: { user1Id: u1, user2Id: u2 } },
        create: { user1Id: u1, user2Id: u2 },
        update: {},
      });
      conversationId = conv.id;
    }

    return {
      conversationId,
      professionalId: session.professionalUserId,
      professionalName: [
        session.professional.firstName,
        session.professional.lastName,
      ].filter(Boolean).join(' '),
      professionalAvatar: session.professional.professionalProfile?.avatarUrl ?? null,
      sessionTitle: session.title,
    };
  }

  async getMyActiveSessions(clientUserId: string) {
    const payments = await this.prisma.sessionPayment.findMany({
      where: { clientUserId, status: 'APPROVED' },
      include: {
        session: {
          include: {
            professional: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                professionalProfile: { select: { avatarUrl: true, username: true, bio: true } },
                professionalSpecialties: {
                  take: 3,
                  include: { specialty: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      sessionId: p.sessionId,
      sessionTitle: p.session.title,
      sessionStatus: p.session.status,
      durationMinutes: p.session.durationMinutes,
      priceInBs: Number(p.session.priceInBs),
      priceInUsd: Number(p.session.priceInUsd),
      currency: p.currency,
      amountPaid: Number(p.currency === 'USD' ? p.amountUsd : p.amountBs),
      endedAt: p.session.endedAt,
      professional: {
        id: p.session.professional.id,
        firstName: p.session.professional.firstName,
        lastName: p.session.professional.lastName,
        avatarUrl: p.session.professional.professionalProfile?.avatarUrl ?? null,
        bio: p.session.professional.professionalProfile?.bio ?? null,
        specialties: p.session.professional.professionalSpecialties.map((ps) => ps.specialty.name),
      },
    }));
  }

  async getMyPaymentStatus(clientUserId: string, sessionId: string) {
    const payment = await this.prisma.sessionPayment.findUnique({
      where: { sessionId_clientUserId: { sessionId, clientUserId } },
    });
    if (!payment) return { status: 'NONE', currency: null };
    return { status: payment.status, currency: payment.currency };
  }

  async paySessionWithQr(clientUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    if (session.status === 'CANCELLED') throw new BadRequestException('La sesion fue cancelada.');
    if (session.status === 'COMPLETED') throw new BadRequestException('La sesion ya finalizo.');

    const existing = await this.prisma.sessionPayment.findUnique({
      where: { sessionId_clientUserId: { sessionId, clientUserId } },
    });
    if (existing?.status === 'APPROVED') {
      return { status: 'APPROVED', paymentId: existing.id, qrId: existing.bancoQrId };
    }

    return this.banecoQrService.createQrForSession(clientUserId, session);
  }

  async paySessionWithStripe(clientUserId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesion no encontrada.');
    if (session.status === 'CANCELLED') throw new BadRequestException('La sesion fue cancelada.');
    if (session.status === 'COMPLETED') throw new BadRequestException('La sesion ya finalizo.');

    const existing = await this.prisma.sessionPayment.findUnique({
      where: { sessionId_clientUserId: { sessionId, clientUserId } },
    });
    if (existing?.status === 'APPROVED') {
      return { status: 'APPROVED', paymentId: existing.id };
    }

    return this.stripeService.createPaymentIntentForSession(clientUserId, session);
  }
}
