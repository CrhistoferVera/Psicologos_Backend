import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type RuntimeSystemConfig = {
  platformFeePercent: number;
  creditValueBs: number;
  creditToSolesRate: number;
  usdExchangeRate: number;
  minAppVersion: string;
  referralPercentage: number;
  referralRewardCredits: number;
  referralMinDepositAmount: number;
  referralEnabled: boolean;
  referralValidPurchasesRequired: number;
  referralThreshold: number;
  referralClientDiscountPercent: number;
  referralClientDiscountSessions: number;
  referralProfessionalRewardPercent: number;
  paymentsEnabled: boolean;
  withdrawalsEnabled: boolean;
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
    const referralValidPurchasesRequired = this.normalizeNonNegativeInt(
      process.env.REFERRAL_VALID_PURCHASES_REQUIRED,
      1,
    );
    const referralThreshold = this.normalizePositiveInt(process.env.REFERRAL_THRESHOLD, 10);
    const referralClientDiscountPercent = this.normalizePercent(
      process.env.REFERRAL_CLIENT_DISCOUNT_PERCENT,
      5,
    );
    const referralClientDiscountSessions = this.normalizePositiveInt(
      process.env.REFERRAL_CLIENT_DISCOUNT_SESSIONS,
      10,
    );
    const referralProfessionalRewardPercent = this.normalizePercent(
      process.env.REFERRAL_PROFESSIONAL_REWARD_PERCENT,
      5,
    );

    return {
      platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT ?? '50'),
      creditValueBs,
      usdExchangeRate: Number(process.env.BOB_TO_USD_RATE ?? '6.96'),
      minAppVersion: process.env.MIN_APP_VERSION ?? '1.0',
      referralPercentage: Number(process.env.REFERRAL_PERCENTAGE ?? '2.5'),
      referralRewardCredits: Number(process.env.REFERRAL_REWARD_CREDITS ?? '10'),
      referralMinDepositAmount: Number(process.env.REFERRAL_MIN_DEPOSIT_AMOUNT ?? '0'),
      referralEnabled: (process.env.REFERRAL_ENABLED ?? 'true').toLowerCase() !== 'false',
      referralValidPurchasesRequired,
      referralThreshold,
      referralClientDiscountPercent,
      referralClientDiscountSessions,
      referralProfessionalRewardPercent,
      paymentsEnabled: (process.env.PAYMENTS_ENABLED ?? 'true').toLowerCase() !== 'false',
      withdrawalsEnabled: (process.env.WITHDRAWALS_ENABLED ?? 'true').toLowerCase() !== 'false',
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
          referralRewardCredits: defaults.referralRewardCredits,
          referralMinDepositAmount: defaults.referralMinDepositAmount,
          referralEnabled: defaults.referralEnabled,
          referralValidPurchasesRequired: defaults.referralValidPurchasesRequired,
          referralThreshold: defaults.referralThreshold,
          referralClientDiscountPercent: defaults.referralClientDiscountPercent,
          referralClientDiscountSessions: defaults.referralClientDiscountSessions,
          referralProfessionalRewardPercent: defaults.referralProfessionalRewardPercent,
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
    const referralValidPurchasesRequired = this.normalizeNonNegativeInt(
      config.referralValidPurchasesRequired,
      defaults.referralValidPurchasesRequired,
    );
    const referralThreshold = this.normalizePositiveInt(
      config.referralThreshold,
      defaults.referralThreshold,
    );
    const referralClientDiscountPercent = this.normalizePercent(
      config.referralClientDiscountPercent,
      defaults.referralClientDiscountPercent,
    );
    const referralClientDiscountSessions = this.normalizePositiveInt(
      config.referralClientDiscountSessions,
      defaults.referralClientDiscountSessions,
    );
    const referralProfessionalRewardPercent = this.normalizePercent(
      config.referralProfessionalRewardPercent,
      defaults.referralProfessionalRewardPercent,
    );

    return {
      platformFeePercent: Number(config.platformFeePercent),
      creditValueBs,
      creditToSolesRate: creditValueBs,
      usdExchangeRate: Number(config.usdExchangeRate ?? process.env.BOB_TO_USD_RATE ?? 6.96),
      minAppVersion: config.minAppVersion,
      referralPercentage: Number(config.referralPercentage),
      referralRewardCredits: Number(config.referralRewardCredits),
      referralMinDepositAmount: Number(config.referralMinDepositAmount),
      referralEnabled: config.referralEnabled,
      referralValidPurchasesRequired,
      referralThreshold,
      referralClientDiscountPercent,
      referralClientDiscountSessions,
      referralProfessionalRewardPercent,
      paymentsEnabled: config.paymentsEnabled,
      withdrawalsEnabled: config.withdrawalsEnabled,
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
        ...(payload.referralPercentage !== undefined ? { referralPercentage: payload.referralPercentage } : {}),
        ...(payload.referralRewardCredits !== undefined ? { referralRewardCredits: payload.referralRewardCredits } : {}),
        ...(payload.referralMinDepositAmount !== undefined ? { referralMinDepositAmount: payload.referralMinDepositAmount } : {}),
        ...(payload.referralEnabled !== undefined ? { referralEnabled: payload.referralEnabled } : {}),
        ...(payload.referralValidPurchasesRequired !== undefined
          ? { referralValidPurchasesRequired: this.normalizeNonNegativeInt(payload.referralValidPurchasesRequired, 1) }
          : {}),
        ...(payload.referralThreshold !== undefined
          ? { referralThreshold: this.normalizePositiveInt(payload.referralThreshold, 10) }
          : {}),
        ...(payload.referralClientDiscountPercent !== undefined
          ? { referralClientDiscountPercent: this.normalizePercent(payload.referralClientDiscountPercent, 5) }
          : {}),
        ...(payload.referralClientDiscountSessions !== undefined
          ? { referralClientDiscountSessions: this.normalizePositiveInt(payload.referralClientDiscountSessions, 10) }
          : {}),
        ...(payload.referralProfessionalRewardPercent !== undefined
          ? { referralProfessionalRewardPercent: this.normalizePercent(payload.referralProfessionalRewardPercent, 5) }
          : {}),
        ...(payload.paymentsEnabled !== undefined ? { paymentsEnabled: payload.paymentsEnabled } : {}),
        ...(payload.withdrawalsEnabled !== undefined ? { withdrawalsEnabled: payload.withdrawalsEnabled } : {}),
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
      referralPercentage: config.referralPercentage,
      referralRewardCredits: config.referralRewardCredits,
      referralMinDepositAmount: config.referralMinDepositAmount,
      referralValidPurchasesRequired: config.referralValidPurchasesRequired,
      referralThreshold: config.referralThreshold,
      referralClientDiscountPercent: config.referralClientDiscountPercent,
      referralClientDiscountSessions: config.referralClientDiscountSessions,
      referralProfessionalRewardPercent: config.referralProfessionalRewardPercent,
      bobToUsdRate: config.usdExchangeRate,
      stripeBonusPercentage,
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
