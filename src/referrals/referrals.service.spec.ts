import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReferralStatus, UserRole } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

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
      findMany: jest.fn(),
    },
    referralReward: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
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

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    const configService = {
      getRuntimeConfig: jest.fn().mockResolvedValue({ referralRewardPercent: 5 }),
    };

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
        status: ReferralStatus.QUALIFIED,
        referrerRole: UserRole.USER,
        referredRole: UserRole.USER,
      });
    });

    it('creates a QUALIFIED referral when code is valid', async () => {
      const result = await service.createReferralLink('referred-1', 'ANACODE');
      expect(prisma.referral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            referrerUserId: 'referrer-1',
            referredUserId: 'referred-1',
            status: ReferralStatus.QUALIFIED,
          }),
        }),
      );
      expect(result.status).toBe(ReferralStatus.QUALIFIED);
    });

    it('throws when referred tries to use their own code', async () => {
      await expect(service.createReferralLink('referrer-1', 'ANACODE')).rejects.toThrow(BadRequestException);
    });

    it('throws when code does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.createReferralLink('referred-1', 'BADCODE')).rejects.toThrow(BadRequestException);
    });

    it('returns existing referral if already linked with same code', async () => {
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
});
