import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReferralStatus, TransactionType, UserRole } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    referral: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    referralRewardEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    referralBonusTier: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
  };
}

function makeConfig(overrides: Partial<Record<string, any>> = {}) {
  return {
    referralEnabled: true,
    referralPercentage: 2.5,
    platformFeePercent: 45,
    creditToSolesRate: 1,
    minAppVersion: '1.0',
    referralRewardCredits: 10,
    referralMinDepositAmount: 0,
    paymentsEnabled: true,
    withdrawalsEnabled: true,
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: ReturnType<typeof makePrisma>;
  let configService: { getRuntimeConfig: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    configService = { getRuntimeConfig: jest.fn().mockResolvedValue(makeConfig()) };

    const mod = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SystemConfigService, useValue: configService },
      ],
    }).compile();

    service = mod.get(ReferralsService);
  });

  // ── createReferralLink ─────────────────────────────────────────────────────

  describe('createReferralLink', () => {
    const referrer = {
      id: 'referrer-1',
      firstName: 'Ana',
      lastName: 'Rios',
      referralCode: 'ANACODE',
      isActive: true,
      role: UserRole.USER,
    };

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(referrer);
      prisma.referral.findUnique.mockResolvedValue(null);
      prisma.referral.create.mockResolvedValue({
        id: 'ref-1',
        codeUsed: 'ANACODE',
        status: ReferralStatus.PENDING,
      });
    });

    it('creates a PENDING referral when code is valid and referred is new', async () => {
      const result = await service.createReferralLink('referred-1', 'ANACODE');
      expect(prisma.referral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            referrerUserId: 'referrer-1',
            referredUserId: 'referred-1',
            status: ReferralStatus.PENDING,
          }),
        }),
      );
      expect(result.status).toBe(ReferralStatus.PENDING);
    });

    it('throws when referred tries to use their own code', async () => {
      await expect(service.createReferralLink('referrer-1', 'ANACODE')).rejects.toThrow(BadRequestException);
    });

    it('throws when code does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.createReferralLink('referred-1', 'BADCODE')).rejects.toThrow(BadRequestException);
    });

    it('returns existing referral if same code already linked', async () => {
      const existing = { id: 'ref-existing', codeUsed: 'ANACODE' };
      prisma.referral.findUnique.mockResolvedValue(existing);
      const result = await service.createReferralLink('referred-1', 'ANACODE');
      expect(prisma.referral.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('throws when referred already has a different referral', async () => {
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-old', codeUsed: 'OTHERCODE' });
      await expect(service.createReferralLink('referred-1', 'ANACODE')).rejects.toThrow(BadRequestException);
    });
  });

  // ── maybeRewardReferralOnProfessionalEarning ───────────────────────────────

  describe('maybeRewardReferralOnProfessionalEarning', () => {
    const referral = {
      id: 'ref-1',
      referrerUserId: 'referrer-1',
      status: ReferralStatus.PENDING,
    };
    const referrerWallet = { id: 'wallet-1', balance: 0 };
    const rewardTx = { id: 'reward-tx-1' };
    const rewardEvent = { id: 'event-1' };

    function setupTxMock(tx: any) {
      tx.referral.findFirst.mockResolvedValue(referral);
      tx.referralRewardEvent.findUnique.mockResolvedValue(null);
      tx.referralBonusTier.findMany.mockResolvedValue([]);
      tx.referral.count.mockResolvedValue(0);
      tx.wallet.upsert.mockResolvedValue(referrerWallet);
      tx.transaction.create.mockResolvedValue(rewardTx);
      tx.referralRewardEvent.create.mockResolvedValue(rewardEvent);
      tx.referral.update.mockResolvedValue({});
    }

    it('creates reward event and transitions PENDING → ACTIVE on first earning', async () => {
      const tx = makePrisma();
      setupTxMock(tx);

      const result = await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-1',
        earningTransactionId: 'earning-tx-1',
        earningRealAmount: 100,
      });

      expect(tx.referralRewardEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rewardAmount: 2.5,
            percentageApplied: 2.5,
          }),
        }),
      );
      expect(tx.referral.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReferralStatus.ACTIVE }),
        }),
      );
      expect(result).toBe(rewardEvent);
    });

    it('calculates reward = earningRealAmount * percentage / 100 (rounded to 2dp)', async () => {
      const tx = makePrisma();
      setupTxMock(tx);
      configService.getRuntimeConfig.mockResolvedValue(makeConfig({ referralPercentage: 2.5 }));

      await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-1',
        earningTransactionId: 'earning-tx-1',
        earningRealAmount: 33,
      });

      const created = (tx.referralRewardEvent.create as jest.Mock).mock.calls[0][0];
      expect(created.data.rewardAmount).toBe(0.83); // 33 * 0.025 = 0.825 → 0.83
    });

    it('is idempotent: returns existing event without creating a new one', async () => {
      const tx = makePrisma();
      const existingEvent = { id: 'event-already' };
      tx.referral.findFirst.mockResolvedValue(referral);
      tx.referralRewardEvent.findUnique.mockResolvedValue(existingEvent);

      const result = await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-1',
        earningTransactionId: 'earning-tx-1',
        earningRealAmount: 100,
      });

      expect(tx.referralRewardEvent.create).not.toHaveBeenCalled();
      expect(result).toBe(existingEvent);
    });

    it('does nothing when referral not found (non-referred professional)', async () => {
      const tx = makePrisma();
      tx.referral.findFirst.mockResolvedValue(null);

      const result = await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-no-ref',
        earningTransactionId: 'earning-tx-1',
        earningRealAmount: 100,
      });

      expect(result).toBeNull();
      expect(tx.referralRewardEvent.create).not.toHaveBeenCalled();
    });

    it('does nothing when earningRealAmount is 0 (promotional earning)', async () => {
      const tx = makePrisma();
      tx.referral.findFirst.mockResolvedValue(referral);

      const result = await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-1',
        earningTransactionId: 'earning-tx-promo',
        earningRealAmount: 0,
      });

      expect(result).toBeNull();
      expect(tx.referralRewardEvent.create).not.toHaveBeenCalled();
    });

    it('does nothing when referral program is disabled', async () => {
      configService.getRuntimeConfig.mockResolvedValue(makeConfig({ referralEnabled: false }));
      const tx = makePrisma();
      tx.referral.findFirst.mockResolvedValue(referral);

      const result = await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-1',
        earningTransactionId: 'earning-tx-1',
        earningRealAmount: 100,
      });

      expect(result).toBeNull();
    });

    it('applies bonus tier when referrer has enough active referrals', async () => {
      const tx = makePrisma();
      setupTxMock(tx);
      tx.referralBonusTier.findMany.mockResolvedValue([
        { minActiveReferrals: 5, bonusPercent: 0.5, isActive: true },
      ]);
      tx.referral.count.mockResolvedValue(7); // 7 active > 5 threshold

      await service.maybeRewardReferralOnProfessionalEarning(tx as any, {
        professionalUserId: 'prof-1',
        earningTransactionId: 'earning-tx-1',
        earningRealAmount: 100,
      });

      const created = (tx.referralRewardEvent.create as jest.Mock).mock.calls[0][0];
      expect(created.data.rewardAmount).toBe(3.0); // 2.5 + 0.5 = 3%
      expect(created.data.bonusPercentApplied).toBe(0.5);
    });
  });

  // ── reverseReferralRewardBySourceTransaction ───────────────────────────────

  describe('reverseReferralRewardBySourceTransaction', () => {
    const event = {
      id: 'event-1',
      reversedAt: null,
      rewardAmount: 2.5,
      referral: { referrerUserId: 'referrer-1' },
    };
    const referrerWallet = { id: 'wallet-1', balance: 10 };

    it('debits referrer wallet and stamps reversedAt', async () => {
      const tx = makePrisma();
      tx.referralRewardEvent.findUnique.mockResolvedValue(event);
      tx.wallet.findUnique.mockResolvedValue(referrerWallet);
      tx.wallet.update.mockResolvedValue({});
      tx.transaction.create.mockResolvedValue({ id: 'reversal-tx-1' });
      tx.referralRewardEvent.update.mockResolvedValue({});

      await service.reverseReferralRewardBySourceTransaction(tx as any, 'source-tx-1');

      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: 2.5 } } }),
      );
      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: TransactionType.REFERRAL_REWARD_REVERSAL }),
        }),
      );
      expect(tx.referralRewardEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reversedAt: expect.any(Date) }),
        }),
      );
    });

    it('is idempotent: skips already-reversed events', async () => {
      const tx = makePrisma();
      tx.referralRewardEvent.findUnique.mockResolvedValue({ ...event, reversedAt: new Date() });

      const result = await service.reverseReferralRewardBySourceTransaction(tx as any, 'source-tx-1');

      expect(result).toBeNull();
      expect(tx.wallet.update).not.toHaveBeenCalled();
    });

    it('returns null when no reward event exists for source tx', async () => {
      const tx = makePrisma();
      tx.referralRewardEvent.findUnique.mockResolvedValue(null);

      const result = await service.reverseReferralRewardBySourceTransaction(tx as any, 'source-tx-ghost');

      expect(result).toBeNull();
    });

    it('caps debit at current wallet balance (no negative wallets)', async () => {
      const tx = makePrisma();
      tx.referralRewardEvent.findUnique.mockResolvedValue({ ...event, rewardAmount: 100 });
      tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', balance: 1.5 });
      tx.wallet.update.mockResolvedValue({});
      tx.transaction.create.mockResolvedValue({ id: 'reversal-tx-1' });
      tx.referralRewardEvent.update.mockResolvedValue({});

      await service.reverseReferralRewardBySourceTransaction(tx as any, 'source-tx-1');

      const updateCall = (tx.wallet.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.balance.decrement).toBe(1.5);
    });
  });
});
