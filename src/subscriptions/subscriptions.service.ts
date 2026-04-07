import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertSubscriptionDto } from './dto/upsert-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Anfitriona: gestión de su plan ───────────────────────────────────────

  async upsertMySubscription(userId: string, dto: UpsertSubscriptionDto) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Perfil de anfitriona no encontrado.');

    return this.prisma.anfitrioneSubscription.upsert({
      where: { profileId: profile.id },
      create: { profileId: profile.id, price: dto.price },
      update: { price: dto.price },
    });
  }

  async toggleMySubscription(userId: string) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
      include: { subscription: true },
    });
    if (!profile) throw new NotFoundException('Perfil de anfitriona no encontrado.');
    if (!profile.subscription)
      throw new NotFoundException('No tienes un plan de suscripción creado.');

    return this.prisma.anfitrioneSubscription.update({
      where: { profileId: profile.id },
      data: { isActive: !profile.subscription.isActive },
    });
  }

  async getMySubscription(userId: string) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
      include: { subscription: true },
    });
    if (!profile) throw new NotFoundException('Perfil de anfitriona no encontrado.');
    return profile.subscription;
  }

  // ─── Cliente: comprar y verificar suscripción ─────────────────────────────

  async buySubscription(clientUserId: string, anfitrionaUserId: string) {
    // 1. Obtener el plan de la anfitriona
    const anfitriona = await this.prisma.user.findFirst({
      where: { id: anfitrionaUserId, role: 'ANFITRIONA', isActive: true },
    });
    if (!anfitriona) throw new NotFoundException('Anfitriona no encontrada.');

    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId: anfitrionaUserId },
      include: { subscription: true },
    });
    if (!profile?.subscription || !profile.subscription.isActive) {
      throw new NotFoundException('Esta anfitriona no tiene un plan de suscripción activo.');
    }

    // 2. Verificar si ya tiene suscripción activa
    const existing = await this.prisma.userSubscription.findUnique({
      where: {
        userId_subscriptionId: {
          userId: clientUserId,
          subscriptionId: profile.subscription.id,
        },
      },
    });
    if (existing && existing.expiresAt > new Date()) {
      throw new BadRequestException('Ya tienes una suscripción activa con esta anfitriona.');
    }

    const creditsRequired = profile.subscription.price;

    // 3. Verificar wallet del cliente
    const clientWallet = await this.prisma.wallet.findUnique({
      where: { userId: clientUserId },
    });
    if (!clientWallet) throw new NotFoundException('Wallet del cliente no encontrada.');
    if (Number(clientWallet.balance) < creditsRequired) {
      throw new BadRequestException('Créditos insuficientes para comprar la suscripción.');
    }

    // 4. Wallet de la anfitriona
    const anfitrionaWallet = await this.prisma.wallet.findUnique({
      where: { userId: anfitrionaUserId },
    });
    if (!anfitrionaWallet) throw new NotFoundException('Wallet de la anfitriona no encontrada.');

    const adminUserId = this.config.get<string>('ADMIN_USER_ID');
    const feePct = Number(this.config.get<string>('PLATFORM_FEE_PERCENT') ?? '50') / 100;
    const total = Number(creditsRequired);
    const adminShare = Math.round(total * feePct * 100) / 100;
    const anfitrionaShare = Math.round((total - adminShare) * 100) / 100;

    const adminWallet = adminUserId
      ? await this.prisma.wallet.findUnique({ where: { userId: adminUserId } })
      : null;

    // 5. Transacción atómica: débito cliente + crédito anfitriona + comisión admin
    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { userId: clientUserId },
        data: { balance: { decrement: creditsRequired } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: 'SUBSCRIPTION',
          amount: creditsRequired,
          description: `Suscripción mensual a anfitriona`,
        },
      }),
      this.prisma.wallet.update({
        where: { userId: anfitrionaUserId },
        data: { balance: { increment: anfitrionaShare } },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: anfitrionaWallet.id,
          type: 'EARNING',
          amount: anfitrionaShare,
          description: JSON.stringify({ service: 'Suscripción', clientUserId }),
        },
      }),
      ...(adminWallet && adminShare > 0
        ? [
            this.prisma.wallet.update({
              where: { userId: adminUserId! },
              data: { balance: { increment: adminShare } },
            }),
            this.prisma.transaction.create({
              data: {
                walletId: adminWallet.id,
                type: 'EARNING',
                amount: adminShare,
                description: JSON.stringify({ service: 'Comisión Suscripción', clientUserId }),
              },
            }),
          ]
        : []),
    ]);

    // 6. Crear o renovar la UserSubscription (30 días)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const userSubscription = await this.prisma.userSubscription.upsert({
      where: {
        userId_subscriptionId: {
          userId: clientUserId,
          subscriptionId: profile.subscription.id,
        },
      },
      create: {
        userId: clientUserId,
        subscriptionId: profile.subscription.id,
        expiresAt,
      },
      update: { expiresAt },
    });

    return {
      message: 'Suscripción activada exitosamente.',
      expiresAt: userSubscription.expiresAt,
      creditsSpent: creditsRequired,
    };
  }

  async getSubscriptionStatus(clientUserId: string, anfitrionaUserId: string) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId: anfitrionaUserId },
      include: { subscription: true },
    });

    if (!profile?.subscription) {
      return { isSubscribed: false, expiresAt: null };
    }

    const userSub = await this.prisma.userSubscription.findUnique({
      where: {
        userId_subscriptionId: {
          userId: clientUserId,
          subscriptionId: profile.subscription.id,
        },
      },
    });

    const isSubscribed = !!userSub && userSub.expiresAt > new Date();
    return {
      isSubscribed,
      expiresAt: isSubscribed ? userSub!.expiresAt : null,
    };
  }

  // ─── Cliente: obtener todas sus suscripciones ─────────────────────────────

  async getMySubscriptions(clientUserId: string) {
    const subs = await this.prisma.userSubscription.findMany({
      where: { userId: clientUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            profile: {
              include: {
                user: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    return subs.map((s) => ({
      subscriptionId: s.id,
      anfitrionaId: s.subscription.profile.user.id,
      anfitrionaName: [s.subscription.profile.user.firstName, s.subscription.profile.user.lastName]
        .filter(Boolean)
        .join(' '),
      anfitrionaUsername: s.subscription.profile.username,
      anfitrionaAvatar: s.subscription.profile.avatarUrl,
      price: s.subscription.price,
      isActive: s.expiresAt > new Date(),
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
    }));
  }

  // ─── Helper: usado en la lógica de galería ────────────────────────────────

  async hasActiveSubscription(clientUserId: string, anfitrionaUserId: string): Promise<boolean> {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId: anfitrionaUserId },
      select: { subscription: { select: { id: true } } },
    });

    if (!profile?.subscription) return false;

    const userSub = await this.prisma.userSubscription.findUnique({
      where: {
        userId_subscriptionId: {
          userId: clientUserId,
          subscriptionId: profile.subscription.id,
        },
      },
      select: { expiresAt: true },
    });

    return !!userSub && userSub.expiresAt > new Date();
  }

  // ─── Público: ver el plan de una anfitriona ───────────────────────────────

  async getPublicSubscription(anfitrionaUserId: string) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId: anfitrionaUserId },
      include: { subscription: true },
    });

    const sub = profile?.subscription;
    if (!sub || !sub.isActive) return null;

    return { price: sub.price };
  }
}
