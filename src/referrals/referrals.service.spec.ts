import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReferralStatus, UserRole } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

function makePrisma() {
  const prisma: any = {
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
  // Ejecuta el callback de la transacción con el propio mock como tx.
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  return prisma;
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
      professionalProfile: null,
    };

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(referrer);
      // Usuario referido (sin perfil profesional → se clasifica como USER).
      prisma.user.findUnique.mockResolvedValue({
        id: 'referred-1',
        role: UserRole.USER,
        professionalProfile: null,
      });
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

    it('is idempotent: returns the existing referral without creating another', async () => {
      const existing = { id: 'ref-old', codeUsed: 'OTHERCODE' };
      prisma.referral.findUnique.mockResolvedValue(existing);
      const result = await service.createReferralLink('referred-1', 'ANACODE');
      expect(prisma.referral.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('freezes referred role as PROFESSIONAL when the referred has a professional profile', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'referred-1',
        role: UserRole.USER,
        professionalProfile: { id: 'prof-1' },
      });
      await service.createReferralLink('referred-1', 'ANACODE');
      expect(prisma.referral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ referredRole: UserRole.PROFESSIONAL }),
        }),
      );
    });
  });
});
