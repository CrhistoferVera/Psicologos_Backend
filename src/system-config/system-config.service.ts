import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type RuntimeSystemConfig = {
  platformFeePercent: number;
  creditValueBs: number;
  creditToSolesRate: number;
  usdExchangeRate: number;
  minAppVersion: string;
  referralEnabled: boolean;
  referralRewardPercent: number;
  paymentsEnabled: boolean;
  withdrawalsEnabled: boolean;
  noShowGraceMinutes: number;
  noShowPenaltyPercent: number;
  refundEarlyWindowMinutes: number;
  refundEarlyPercent: number;
  refundLateWindowMinutes: number;
  refundLatePercent: number;
  earningLockMinutes: number;
};

@Injectable()
export class SystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeNonNegativeInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.trunc(parsed));
  }

  private normalizePositiveInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.trunc(parsed));
  }

  private normalizePercent(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < 0) return 0;
    if (parsed > 100) return 100;
    return parsed;
  }

  private fromEnvDefaults() {
    const creditValueBs = Number(process.env.CREDIT_VALUE_BS ?? process.env.CREDIT_TO_SOLES_RATE ?? '1');

    return {
      platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT ?? '50'),
      creditValueBs,
      usdExchangeRate: Number(process.env.BOB_TO_USD_RATE ?? '6.96'),
      minAppVersion: process.env.MIN_APP_VERSION ?? '1.0',
      referralEnabled: (process.env.REFERRAL_ENABLED ?? 'true').toLowerCase() !== 'false',
      referralRewardPercent: this.normalizePercent(process.env.REFERRAL_REWARD_PERCENT, 5),
      paymentsEnabled: (process.env.PAYMENTS_ENABLED ?? 'true').toLowerCase() !== 'false',
      withdrawalsEnabled: (process.env.WITHDRAWALS_ENABLED ?? 'true').toLowerCase() !== 'false',
      noShowGraceMinutes: this.normalizePositiveInt(process.env.NO_SHOW_GRACE_MINUTES, 15),
      noShowPenaltyPercent: this.normalizePercent(process.env.NO_SHOW_PENALTY_PERCENT, 30),
      refundEarlyWindowMinutes: this.normalizePositiveInt(process.env.REFUND_EARLY_WINDOW_MINUTES, 1440),
      refundEarlyPercent: this.normalizePercent(process.env.REFUND_EARLY_PERCENT, 50),
      refundLateWindowMinutes: this.normalizePositiveInt(process.env.REFUND_LATE_WINDOW_MINUTES, 2880),
      refundLatePercent: this.normalizePercent(process.env.REFUND_LATE_PERCENT, 80),
      earningLockMinutes: this.normalizePositiveInt(process.env.EARNING_LOCK_MINUTES, 1440),
    };
  }

  async getOrCreateRaw() {
    const existing = await this.prisma.systemConfig.findUnique({ where: { id: 'global' } });
    if (existing) return existing;

    const defaults = this.fromEnvDefaults();

    try {
      return await this.prisma.systemConfig.create({
        data: {
          id: 'global',
          platformFeePercent: defaults.platformFeePercent,
          creditToSolesRate: defaults.creditValueBs,
          usdExchangeRate: defaults.usdExchangeRate,
          minAppVersion: defaults.minAppVersion,
          referralEnabled: defaults.referralEnabled,
          referralProfessionalRewardPercent: defaults.referralRewardPercent,
          paymentsEnabled: defaults.paymentsEnabled,
          withdrawalsEnabled: defaults.withdrawalsEnabled,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const current = await this.prisma.systemConfig.findUnique({ where: { id: 'global' } });
        if (current) return current;
      }

      throw error;
    }
  }

  toRuntime(config: Awaited<ReturnType<SystemConfigService['getOrCreateRaw']>>): RuntimeSystemConfig {
    const defaults = this.fromEnvDefaults();
    const creditValueBs = Number(config.creditToSolesRate);

    return {
      platformFeePercent: Number(config.platformFeePercent),
      creditValueBs,
      creditToSolesRate: creditValueBs,
      usdExchangeRate: Number(config.usdExchangeRate ?? process.env.BOB_TO_USD_RATE ?? 6.96),
      minAppVersion: config.minAppVersion,
      referralEnabled: config.referralEnabled,
      referralRewardPercent: this.normalizePercent(
        config.referralProfessionalRewardPercent ?? defaults.referralRewardPercent,
        defaults.referralRewardPercent,
      ),
      paymentsEnabled: config.paymentsEnabled,
      withdrawalsEnabled: config.withdrawalsEnabled,
      noShowGraceMinutes: this.normalizePositiveInt(config.noShowGraceMinutes ?? defaults.noShowGraceMinutes, defaults.noShowGraceMinutes),
      noShowPenaltyPercent: this.normalizePercent(config.noShowPenaltyPercent ?? defaults.noShowPenaltyPercent, defaults.noShowPenaltyPercent),
      refundEarlyWindowMinutes: this.normalizePositiveInt(config.refundEarlyWindowMinutes ?? defaults.refundEarlyWindowMinutes, defaults.refundEarlyWindowMinutes),
      refundEarlyPercent: this.normalizePercent(config.refundEarlyPercent ?? defaults.refundEarlyPercent, defaults.refundEarlyPercent),
      refundLateWindowMinutes: this.normalizePositiveInt(config.refundLateWindowMinutes ?? defaults.refundLateWindowMinutes, defaults.refundLateWindowMinutes),
      refundLatePercent: this.normalizePercent(config.refundLatePercent ?? defaults.refundLatePercent, defaults.refundLatePercent),
      earningLockMinutes: this.normalizePositiveInt(config.earningLockMinutes ?? defaults.earningLockMinutes, defaults.earningLockMinutes),
    };
  }

  async getRuntimeConfig(): Promise<RuntimeSystemConfig> {
    const config = await this.getOrCreateRaw();
    return this.toRuntime(config);
  }

  async updateConfig(payload: Partial<RuntimeSystemConfig>) {
    await this.getOrCreateRaw();
    const creditValueBs = payload.creditValueBs ?? payload.creditToSolesRate;

    const updated = await this.prisma.systemConfig.update({
      where: { id: 'global' },
      data: {
        ...(payload.platformFeePercent !== undefined ? { platformFeePercent: payload.platformFeePercent } : {}),
        ...(creditValueBs !== undefined ? { creditToSolesRate: creditValueBs } : {}),
        ...(payload.usdExchangeRate !== undefined ? { usdExchangeRate: payload.usdExchangeRate } : {}),
        ...(payload.minAppVersion !== undefined ? { minAppVersion: payload.minAppVersion } : {}),
        ...(payload.referralEnabled !== undefined ? { referralEnabled: payload.referralEnabled } : {}),
        ...(payload.referralRewardPercent !== undefined
          ? { referralProfessionalRewardPercent: this.normalizePercent(payload.referralRewardPercent, 5) }
          : {}),
        ...(payload.paymentsEnabled !== undefined ? { paymentsEnabled: payload.paymentsEnabled } : {}),
        ...(payload.withdrawalsEnabled !== undefined ? { withdrawalsEnabled: payload.withdrawalsEnabled } : {}),
        ...(payload.noShowGraceMinutes !== undefined ? { noShowGraceMinutes: payload.noShowGraceMinutes } : {}),
        ...(payload.noShowPenaltyPercent !== undefined ? { noShowPenaltyPercent: payload.noShowPenaltyPercent } : {}),
        ...(payload.refundEarlyWindowMinutes !== undefined ? { refundEarlyWindowMinutes: payload.refundEarlyWindowMinutes } : {}),
        ...(payload.refundEarlyPercent !== undefined ? { refundEarlyPercent: payload.refundEarlyPercent } : {}),
        ...(payload.refundLateWindowMinutes !== undefined ? { refundLateWindowMinutes: payload.refundLateWindowMinutes } : {}),
        ...(payload.refundLatePercent !== undefined ? { refundLatePercent: payload.refundLatePercent } : {}),
        ...(payload.earningLockMinutes !== undefined ? { earningLockMinutes: payload.earningLockMinutes } : {}),
      },
    });

    return this.toRuntime(updated);
  }

  async getPublicConfig() {
    const config = await this.getRuntimeConfig();
    const stripeBonusPercentage = Number(process.env.STRIPE_BONUS_PERCENTAGE ?? '0.35');

    return {
      creditValueBs: config.creditValueBs,
      creditToSolesRate: config.creditToSolesRate,
      usdExchangeRate: config.usdExchangeRate,
      minVersion: config.minAppVersion,
      paymentsEnabled: config.paymentsEnabled,
      withdrawalsEnabled: config.withdrawalsEnabled,
      referralEnabled: config.referralEnabled,
      referralRewardPercent: config.referralRewardPercent,
      bobToUsdRate: config.usdExchangeRate,
      stripeBonusPercentage,
      noShowGraceMinutes: config.noShowGraceMinutes,
    };
  }

  async getPlatformFeePercent() {
    const config = await this.getRuntimeConfig();
    return config.platformFeePercent;
  }

  async getCreditToSolesRate() {
    const config = await this.getRuntimeConfig();
    return config.creditValueBs;
  }

  async isPaymentsEnabled() {
    const config = await this.getRuntimeConfig();
    return config.paymentsEnabled;
  }

  async isWithdrawalsEnabled() {
    const config = await this.getRuntimeConfig();
    return config.withdrawalsEnabled;
  }
}
