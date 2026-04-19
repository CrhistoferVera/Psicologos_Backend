import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralStatus, TransactionType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AdminReferralsQueryDto } from './dto/admin-referrals-query.dto';
import { createUniqueReferralCode } from './utils/referral-code.util';

/**
 * Transiciones de ReferralStatus:
 *
 * PENDING  → se crea en createReferralLink() cuando el profesional se registra
 *             con el código de un usuario/profesional referente.
 *
 * ACTIVE   → primera vez que el profesional referido genera una ganancia real
 *             (EARNING transaction). Ocurre dentro de maybeRewardReferralOnProfessionalEarning().
 *             A partir de aquí sigue generando reward events por cada EARNING.
 *
 * QUALIFIED/REWARDED → estados del sistema anterior (depósito único). Migrados
 *             automáticamente a ACTIVE en migration 20260419120000.
 *
 * No existe estado terminal en el nuevo sistema; el vínculo es permanente mientras
 * el profesional referido siga activo.
 */

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  // ---------------------------------------------------------------------------
  // Código de referido
  // ---------------------------------------------------------------------------

  async ensureUserReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, referralCode: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');
    if (user.referralCode) return user.referralCode;

    const generated = await createUniqueReferralCode(this.prisma, user.firstName ?? user.id.slice(0, 6));
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode: generated },
      select: { referralCode: true },
    });

    return updated.referralCode as string;
  }

  async resolveReferrerByCode(rawCode: string) {
    const code = this.normalizeCode(rawCode);

    const referrer = await this.prisma.user.findFirst({
      where: {
        referralCode: code,
        isActive: true,
        role: { not: UserRole.ADMIN },
      },
      select: { id: true, firstName: true, lastName: true, referralCode: true },
    });

    if (!referrer) throw new BadRequestException('Codigo de referido invalido.');
    return referrer;
  }

  async createReferralLink(referredUserId: string, rawCode: string) {
    const referrer = await this.resolveReferrerByCode(rawCode);

    if (referrer.id === referredUserId) {
      throw new BadRequestException('No puedes usar tu propio codigo de referido.');
    }

    const existing = await this.prisma.referral.findUnique({
      where: { referredUserId },
      select: { id: true, codeUsed: true },
    });

    if (existing) {
      if (existing.codeUsed === referrer.referralCode) return existing;
      throw new BadRequestException('Este usuario ya tiene un referido asociado.');
    }

    return this.prisma.referral.create({
      data: {
        referrerUserId: referrer.id,
        referredUserId,
        codeUsed: referrer.referralCode as string,
        status: ReferralStatus.PENDING,
      },
      select: { id: true, codeUsed: true, status: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Bonus tiers
  // ---------------------------------------------------------------------------

  /**
   * Calcula el bonus porcentual adicional según cuántos referidos ACTIVOS tiene
   * el referente. Se aplica el tier más alto que corresponda.
   * Ej: base=2.5%, 5+ activos → +0.5% → total 3%.
   */
  private async resolveApplicableBonusPercent(
    tx: Prisma.TransactionClient,
    referrerUserId: string,
  ): Promise<number> {
    const activeTiers = await tx.referralBonusTier.findMany({
      where: { isActive: true },
      orderBy: { minActiveReferrals: 'desc' },
    });

    if (activeTiers.length === 0) return 0;

    const activeCount = await tx.referral.count({
      where: {
        referrerUserId,
        status: { in: [ReferralStatus.ACTIVE, ReferralStatus.QUALIFIED] },
      },
    });

    for (const tier of activeTiers) {
      if (activeCount >= tier.minActiveReferrals) {
        return Number(tier.bonusPercent);
      }
    }

    return 0;
  }

  async getAdminBonusTiers() {
    return this.prisma.referralBonusTier.findMany({ orderBy: { minActiveReferrals: 'asc' } });
  }

  async upsertAdminBonusTier(dto: {
    id?: string;
    label: string;
    minActiveReferrals: number;
    bonusPercent: number;
    isActive?: boolean;
  }) {
    if (dto.id) {
      return this.prisma.referralBonusTier.update({
        where: { id: dto.id },
        data: {
          label: dto.label,
          minActiveReferrals: dto.minActiveReferrals,
          bonusPercent: dto.bonusPercent,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    }
    return this.prisma.referralBonusTier.create({
      data: {
        label: dto.label,
        minActiveReferrals: dto.minActiveReferrals,
        bonusPercent: dto.bonusPercent,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async deleteAdminBonusTier(id: string) {
    await this.prisma.referralBonusTier.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Recompensa de referido — crear
  // ---------------------------------------------------------------------------

  /**
   * Hook principal. Ejecutar DENTRO de una $transaction interactiva.
   *
   * Fuentes elegibles: cualquier EARNING transaction con realAmount > 0
   * del profesional referido. Cubre mensajes, llamadas y videollamadas.
   *
   * Fuentes NO elegibles (excluidas automáticamente):
   *  - PROMOTIONAL_GRANT (créditos regalados por admin)
   *  - EARNING con isPromotional=true o realAmount=0
   *  - Cualquier otro tipo de transacción
   *
   * Idempotencia: sourceTransactionId tiene constraint @unique en BD.
   * Si falla la TX padre todo se revierte (mismo tx client).
   */
  async maybeRewardReferralOnProfessionalEarning(
    tx: Prisma.TransactionClient,
    params: {
      professionalUserId: string;
      earningTransactionId: string;
      earningRealAmount: number;
    },
  ) {
    const config = await this.systemConfigService.getRuntimeConfig();
    if (!config.referralEnabled || config.referralPercentage <= 0) return null;
    if (params.earningRealAmount <= 0) return null;

    const referral = await tx.referral.findFirst({
      where: {
        referredUserId: params.professionalUserId,
        // PENDING: primer earning activa el vínculo
        // ACTIVE/QUALIFIED: vínculo ya activo, sigue generando rewards
        status: { in: [ReferralStatus.PENDING, ReferralStatus.ACTIVE, ReferralStatus.QUALIFIED] },
      },
      select: { id: true, referrerUserId: true, status: true },
    });

    if (!referral) return null;

    // Idempotencia: constraint único en BD también lo garantiza, esto evita el round-trip de error
    const existing = await tx.referralRewardEvent.findUnique({
      where: { sourceTransactionId: params.earningTransactionId },
    });
    if (existing) return existing;

    const bonusPercent = await this.resolveApplicableBonusPercent(tx, referral.referrerUserId);
    const totalPercent = config.referralPercentage + bonusPercent;
    const rewardAmount = Math.round(params.earningRealAmount * totalPercent / 100 * 100) / 100;
    if (rewardAmount <= 0) return null;

    const referrerWallet = await tx.wallet.upsert({
      where: { userId: referral.referrerUserId },
      create: { userId: referral.referrerUserId, balance: rewardAmount, promotionalBalance: 0 },
      update: { balance: { increment: rewardAmount } },
    });

    const rewardTx = await tx.transaction.create({
      data: {
        walletId: referrerWallet.id,
        type: TransactionType.REFERRAL_REWARD,
        amount: rewardAmount,
        promotionalAmount: 0,
        realAmount: rewardAmount,
        isPromotional: false,
        description: `Referido: ${config.referralPercentage}%${bonusPercent > 0 ? `+${bonusPercent}% bonus` : ''} sobre ganancia profesional`,
      },
    });

    const rewardEvent = await tx.referralRewardEvent.create({
      data: {
        referralId: referral.id,
        sourceTransactionId: params.earningTransactionId,
        rewardTransactionId: rewardTx.id,
        rewardAmount,
        percentageApplied: config.referralPercentage,
        bonusPercentApplied: bonusPercent,
      },
    });

    // PENDING → ACTIVE en la primera ganancia real del profesional referido
    if (referral.status === ReferralStatus.PENDING) {
      await tx.referral.update({
        where: { id: referral.id },
        data: { status: ReferralStatus.ACTIVE, qualifiedAt: new Date() },
      });
    }

    return rewardEvent;
  }

  // ---------------------------------------------------------------------------
  // Recompensa de referido — revertir
  // ---------------------------------------------------------------------------

  /**
   * Revierte una recompensa de referido previamente emitida, debitando el
   * mismo importe de la wallet del referente. Ejecutar DENTRO de una $transaction.
   *
   * Cuándo llamar: cuando la transacción EARNING fuente es cancelada o refunded.
   * Idempotente: si el evento ya fue revertido, retorna null sin hacer nada.
   * Trazabilidad: crea una transaction REFERRAL_REWARD_REVERSAL y actualiza
   * el campo reversedAt + reversalTransactionId del ReferralRewardEvent.
   */
  async reverseReferralRewardBySourceTransaction(
    tx: Prisma.TransactionClient,
    sourceTransactionId: string,
  ) {
    const event = await tx.referralRewardEvent.findUnique({
      where: { sourceTransactionId },
      select: {
        id: true,
        reversedAt: true,
        rewardAmount: true,
        referral: { select: { referrerUserId: true } },
      },
    });

    if (!event) return null;     // nunca hubo reward para esta tx
    if (event.reversedAt) return null;  // ya revertido, idempotente

    const rewardAmount = Number(event.rewardAmount);
    const referrerUserId = event.referral.referrerUserId;

    const referrerWallet = await tx.wallet.findUnique({ where: { userId: referrerUserId } });
    if (!referrerWallet) {
      this.logger.warn(`reverseReferralReward: wallet not found for referrer ${referrerUserId}`);
      return null;
    }

    // Debitar solo hasta 0; no llevar wallet a negativo
    const debitAmount = Math.min(rewardAmount, Math.max(0, Number(referrerWallet.balance)));
    if (debitAmount > 0) {
      await tx.wallet.update({
        where: { id: referrerWallet.id },
        data: { balance: { decrement: debitAmount } },
      });
    }

    const reversalTx = await tx.transaction.create({
      data: {
        walletId: referrerWallet.id,
        type: TransactionType.REFERRAL_REWARD_REVERSAL,
        amount: debitAmount,
        promotionalAmount: 0,
        realAmount: debitAmount,
        isPromotional: false,
        description: `Reverso de reward por tx fuente ${sourceTransactionId}`,
      },
    });

    return tx.referralRewardEvent.update({
      where: { id: event.id },
      data: {
        reversedAt: new Date(),
        reversalTransactionId: reversalTx.id,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Consultas — usuario
  // ---------------------------------------------------------------------------

  async getMyReferrals(userId: string) {
    const referralCode = await this.ensureUserReferralCode(userId);

    const rows = await this.prisma.referral.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        referred: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true },
        },
        rewardEvents: {
          where: { reversedAt: null },   // sólo rewards vigentes
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            rewardAmount: true,
            percentageApplied: true,
            bonusPercentApplied: true,
            createdAt: true,
          },
        },
      },
    });

    const totalRewards = rows.reduce(
      (sum, r) => sum + r.rewardEvents.reduce((s, e) => s + Number(e.rewardAmount), 0),
      0,
    );

    return {
      code: referralCode,
      referralCode,
      invitedCount: rows.length,
      totalInvites: rows.length,
      bonusCredits: totalRewards,
      totalBonusCredits: totalRewards,
      stats: {
        pending: rows.filter((r) => r.status === ReferralStatus.PENDING).length,
        active: rows.filter((r) => r.status === ReferralStatus.ACTIVE).length,
        qualified: rows.filter((r) => r.status === ReferralStatus.QUALIFIED).length,
        rewarded: rows.filter((r) => r.status === ReferralStatus.REWARDED).length,
      },
      history: rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
        rewardedAt: r.rewardedAt,
        codeUsed: r.codeUsed,
        totalRewardCredits: r.rewardEvents.reduce((s, e) => s + Number(e.rewardAmount), 0),
        rewardEvents: r.rewardEvents.map((e) => ({
          id: e.id,
          rewardAmount: Number(e.rewardAmount),
          percentageApplied: Number(e.percentageApplied),
          bonusPercentApplied: Number(e.bonusPercentApplied),
          createdAt: e.createdAt,
        })),
        referred: {
          id: r.referred.id,
          fullName: [r.referred.firstName, r.referred.lastName].filter(Boolean).join(' '),
          email: r.referred.email,
          role: r.referred.role,
          createdAt: r.referred.createdAt,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Consultas — admin
  // ---------------------------------------------------------------------------

  async getAdminReferrals(query: AdminReferralsQueryDto) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    const where: Prisma.ReferralWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { codeUsed: { contains: query.search, mode: 'insensitive' } },
              { referrer: { OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ] } },
              { referred: { OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ] } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.referral.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      include: {
        referrer: { select: { id: true, firstName: true, lastName: true, email: true, referralCode: true, role: true } },
        referred: { select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true } },
        rewardEvents: {
          select: {
            id: true,
            rewardAmount: true,
            percentageApplied: true,
            bonusPercentApplied: true,
            sourceTransactionId: true,
            reversedAt: true,
            reversalTransactionId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) nextCursor = rows.pop()?.id ?? null;

    const [total, pending, active, qualified, rewarded, rewardEventsAgg] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: ReferralStatus.PENDING } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.ACTIVE } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.QUALIFIED } }),
      this.prisma.referral.count({ where: { status: ReferralStatus.REWARDED } }),
      this.prisma.referralRewardEvent.aggregate({
        _sum: { rewardAmount: true },
        where: { reversedAt: null },
      }),
    ]);

    return {
      data: rows.map((r) => {
        const netRewards = r.rewardEvents
          .filter((e) => !e.reversedAt)
          .reduce((s, e) => s + Number(e.rewardAmount), 0);
        return {
          id: r.id,
          status: r.status,
          codeUsed: r.codeUsed,
          rewardCredits: netRewards,
          createdAt: r.createdAt,
          qualifiedAt: r.qualifiedAt,
          rewardedAt: r.rewardedAt,
          referrer: {
            id: r.referrer.id,
            fullName: [r.referrer.firstName, r.referrer.lastName].filter(Boolean).join(' '),
            email: r.referrer.email,
            referralCode: r.referrer.referralCode,
            role: r.referrer.role,
          },
          referred: {
            id: r.referred.id,
            fullName: [r.referred.firstName, r.referred.lastName].filter(Boolean).join(' '),
            email: r.referred.email,
            role: r.referred.role,
            createdAt: r.referred.createdAt,
          },
          rewardEvents: r.rewardEvents.map((e) => ({
            id: e.id,
            rewardAmount: Number(e.rewardAmount),
            percentageApplied: Number(e.percentageApplied),
            bonusPercentApplied: Number(e.bonusPercentApplied),
            sourceTransactionId: e.sourceTransactionId,
            reversedAt: e.reversedAt,
            reversalTransactionId: e.reversalTransactionId,
            createdAt: e.createdAt,
          })),
        };
      }),
      nextCursor,
      summary: {
        total,
        pending,
        active,
        qualified,
        rewarded,
        totalRewardCredits: Number(rewardEventsAgg._sum.rewardAmount ?? 0),
      },
    };
  }
}
