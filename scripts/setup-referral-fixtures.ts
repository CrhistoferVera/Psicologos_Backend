import { ConfigService } from '@nestjs/config';
import {
  DepositStatus,
  Prisma,
  TransactionType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { PrismaService } from '../src/prisma.service';
import { ReferralsService } from '../src/referrals/referrals.service';
import { SystemConfigService } from '../src/system-config/system-config.service';

dotenv.config({ path: '.env' });

const TEST_PASSWORD = '123456';
const MIN_BALANCE = new Prisma.Decimal(1000);
const TOPUP_AMOUNT = new Prisma.Decimal(100);

function buildPhoneFromEmail(email: string) {
  const numeric = email
    .replace(/[^0-9]/g, '')
    .padEnd(8, '0')
    .slice(0, 8);
  return `700${numeric}`;
}

async function ensureUser(
  prisma: PrismaService,
  email: string,
  firstName: string,
  lastName: string,
) {
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { wallet: true },
  });

  if (existing) return { user: existing, created: false };

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const phoneNumber = buildPhoneFromEmail(email);

  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      firstName,
      lastName,
      role: UserRole.USER,
      isActive: true,
      phoneNumber,
      phoneDialCode: '+591',
      phoneCountryIso: 'BO',
      phoneCountryName: 'Bolivia',
      billingRegion: 'BOLIVIA',
      preferredCurrency: 'BOB',
      userProfile: {
        create: {},
      },
      wallet: {
        create: {
          balance: MIN_BALANCE,
          promotionalBalance: new Prisma.Decimal(0),
          balanceUsd: MIN_BALANCE,
        },
      },
    },
    include: { wallet: true },
  });

  return { user, created: true };
}

async function ensureWalletMinimum(prisma: PrismaService, userId: string) {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: {
      userId,
      balance: MIN_BALANCE,
      promotionalBalance: new Prisma.Decimal(0),
      balanceUsd: MIN_BALANCE,
    },
    update: {},
  });

  const nextBalance = Prisma.Decimal.max(wallet.balance, MIN_BALANCE);
  const nextBalanceUsd = Prisma.Decimal.max(wallet.balanceUsd, MIN_BALANCE);

  if (!nextBalance.equals(wallet.balance) || !nextBalanceUsd.equals(wallet.balanceUsd)) {
    return prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: nextBalance,
        balanceUsd: nextBalanceUsd,
      },
    });
  }

  return wallet;
}

async function getValidPurchaseStats(prisma: PrismaService, userId: string) {
  const [validTopups, validBookingSessions, validLegacySessions] = await Promise.all([
    prisma.depositRequest.count({
      where: {
        userId,
        status: DepositStatus.APPROVED,
        amount: { gt: new Prisma.Decimal(0) },
      },
    }),
    prisma.booking.count({
      where: {
        clientId: userId,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        payments: {
          some: {
            status: 'PAID',
          },
        },
      },
    }),
    prisma.sessionPayment.count({
      where: {
        clientUserId: userId,
        status: 'APPROVED',
      },
    }),
  ]);

  const validPaidSessions = validBookingSessions + validLegacySessions;

  return {
    validTopups,
    validPaidSessions,
    validPurchaseCount: validTopups + validPaidSessions,
  };
}

async function createTopupFixture(
  prisma: PrismaService,
  referralsService: ReferralsService,
  userId: string,
  userEmail: string,
  index: number,
) {
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: {
        userId,
        balance: new Prisma.Decimal(0),
        promotionalBalance: new Prisma.Decimal(0),
        balanceUsd: new Prisma.Decimal(0),
      },
      update: {},
    });

    const deposit = await tx.depositRequest.create({
      data: {
        userId,
        amount: TOPUP_AMOUNT,
        status: DepositStatus.APPROVED,
        packageNameAtMoment: 'REFERRAL_FIXTURE_VALID_PURCHASE',
      },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: TOPUP_AMOUNT } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        depositRequestId: deposit.id,
        type: TransactionType.DEPOSIT,
        amount: TOPUP_AMOUNT,
        promotionalAmount: new Prisma.Decimal(0),
        realAmount: TOPUP_AMOUNT,
        isPromotional: false,
        description: JSON.stringify({
          source: 'referral-fixture',
          purpose: 'valid-wallet-topup',
          referredEmail: userEmail,
          sequence: index,
        }),
      },
    });

    await referralsService.handleApprovedDepositForReferral(tx, userId);
  });
}

async function main() {
  const prisma = new PrismaService(new ConfigService());
  const systemConfigService = new SystemConfigService(prisma);
  const referralsService = new ReferralsService(prisma, systemConfigService);

  await prisma.$connect();

  try {
    const runtime = await systemConfigService.getRuntimeConfig();
    const requiredValidPurchases = Math.max(0, Math.trunc(runtime.referralValidPurchasesRequired ?? 1));

    const user12Result = await ensureUser(prisma, 'user12@gmail.com', 'Usuario', 'Doce');
    await ensureWalletMinimum(prisma, user12Result.user.id);
    const user12Code = await referralsService.ensureUserReferralCode(user12Result.user.id);

    const user22Result = await ensureUser(prisma, 'user22@gmail.com', 'Usuario', 'Veintidos');
    await ensureWalletMinimum(prisma, user22Result.user.id);

    const referralLink = await referralsService.createReferralLink(user22Result.user.id, user12Code);

    const beforeStats = await getValidPurchaseStats(prisma, user22Result.user.id);
    let createdValidPurchases = 0;

    if (requiredValidPurchases > beforeStats.validPurchaseCount) {
      const missing = requiredValidPurchases - beforeStats.validPurchaseCount;
      for (let i = 0; i < missing; i += 1) {
        await createTopupFixture(
          prisma,
          referralsService,
          user22Result.user.id,
          user22Result.user.email ?? 'user22@gmail.com',
          i + 1,
        );
        createdValidPurchases += 1;
      }
    } else if (requiredValidPurchases === 0) {
      await prisma.$transaction(async (tx) => {
        await referralsService.refreshReferralQualificationForUser(tx, user22Result.user.id);
      });
    }

    const afterStats = await getValidPurchaseStats(prisma, user22Result.user.id);

    const finalReferral = await prisma.referral.findUnique({
      where: { referredUserId: user22Result.user.id },
      select: {
        id: true,
        status: true,
        validPurchasesCount: true,
        qualifiedAt: true,
        referrer: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    const user12AsReferred = await prisma.referral.findUnique({
      where: { referredUserId: user12Result.user.id },
      select: {
        id: true,
        status: true,
        referrer: { select: { id: true, email: true } },
      },
    });

    const user12BeneficiaryForPsicologo1 = await prisma.referralProfessionalBeneficiary.findFirst({
      where: {
        referredUserId: user12Result.user.id,
        professionalReferrer: { email: 'psicologo1@gmail.com' },
        isActive: true,
      },
      select: {
        id: true,
        rewardPercent: true,
        isActive: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          config: {
            referralValidPurchasesRequired: requiredValidPurchases,
          },
          user12: {
            id: user12Result.user.id,
            email: user12Result.user.email,
            created: user12Result.created,
            referralCode: user12Code,
          },
          user22: {
            id: user22Result.user.id,
            email: user22Result.user.email,
            created: user22Result.created,
            validPurchasesBefore: beforeStats.validPurchaseCount,
            validPurchasesAfter: afterStats.validPurchaseCount,
            validTopupsAfter: afterStats.validTopups,
            validPaidSessionsAfter: afterStats.validPaidSessions,
            createdValidPurchases,
          },
          referralUser12ToUser22: {
            id: referralLink?.id ?? finalReferral?.id ?? null,
            status: finalReferral?.status ?? null,
            validPurchasesCount: finalReferral?.validPurchasesCount ?? 0,
            qualifiedAt: finalReferral?.qualifiedAt ?? null,
            referrerEmail: finalReferral?.referrer?.email ?? null,
          },
          user12OriginalRelation: user12AsReferred,
          user12BeneficiaryForPsicologo1,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
