import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type RuntimeSystemConfig = {
  platformFeePercent: number;
  creditToSolesRate: number;
  minAppVersion: string;
  referralRewardCredits: number;
  referralMinDepositAmount: number;
  referralEnabled: boolean;
  paymentsEnabled: boolean;
  withdrawalsEnabled: boolean;
};

@Injectable()
export class SystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private fromEnvDefaults() {
    return {
      platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT ?? '50'),
      creditToSolesRate: Number(process.env.CREDIT_TO_SOLES_RATE ?? '1'),
      minAppVersion: process.env.MIN_APP_VERSION ?? '1.0',
      referralRewardCredits: Number(process.env.REFERRAL_REWARD_CREDITS ?? '10'),
      referralMinDepositAmount: Number(process.env.REFERRAL_MIN_DEPOSIT_AMOUNT ?? '0'),
      referralEnabled: (process.env.REFERRAL_ENABLED ?? 'true').toLowerCase() !== 'false',
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
          creditToSolesRate: defaults.creditToSolesRate,
          minAppVersion: defaults.minAppVersion,
          referralRewardCredits: defaults.referralRewardCredits,
          referralMinDepositAmount: defaults.referralMinDepositAmount,
          referralEnabled: defaults.referralEnabled,
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
    return {
      platformFeePercent: Number(config.platformFeePercent),
      creditToSolesRate: Number(config.creditToSolesRate),
      minAppVersion: config.minAppVersion,
      referralRewardCredits: Number(config.referralRewardCredits),
      referralMinDepositAmount: Number(config.referralMinDepositAmount),
      referralEnabled: config.referralEnabled,
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

    const updated = await this.prisma.systemConfig.update({
      where: { id: 'global' },
      data: {
        ...(payload.platformFeePercent !== undefined ? { platformFeePercent: payload.platformFeePercent } : {}),
        ...(payload.creditToSolesRate !== undefined ? { creditToSolesRate: payload.creditToSolesRate } : {}),
        ...(payload.minAppVersion !== undefined ? { minAppVersion: payload.minAppVersion } : {}),
        ...(payload.referralRewardCredits !== undefined ? { referralRewardCredits: payload.referralRewardCredits } : {}),
        ...(payload.referralMinDepositAmount !== undefined ? { referralMinDepositAmount: payload.referralMinDepositAmount } : {}),
        ...(payload.referralEnabled !== undefined ? { referralEnabled: payload.referralEnabled } : {}),
        ...(payload.paymentsEnabled !== undefined ? { paymentsEnabled: payload.paymentsEnabled } : {}),
        ...(payload.withdrawalsEnabled !== undefined ? { withdrawalsEnabled: payload.withdrawalsEnabled } : {}),
      },
    });

    return this.toRuntime(updated);
  }

  async getPublicConfig() {
    const config = await this.getRuntimeConfig();
    return {
      creditToSolesRate: config.creditToSolesRate,
      minVersion: config.minAppVersion,
      paymentsEnabled: config.paymentsEnabled,
      withdrawalsEnabled: config.withdrawalsEnabled,
      referralEnabled: config.referralEnabled,
      referralRewardCredits: config.referralRewardCredits,
      referralMinDepositAmount: config.referralMinDepositAmount,
    };
  }

  async getPlatformFeePercent() {
    const config = await this.getRuntimeConfig();
    return config.platformFeePercent;
  }

  async getCreditToSolesRate() {
    const config = await this.getRuntimeConfig();
    return config.creditToSolesRate;
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
