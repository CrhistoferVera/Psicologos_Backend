import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { PrismaService } from '../src/prisma.service';
import { ReferralsService } from '../src/referrals/referrals.service';
import { SystemConfigService } from '../src/system-config/system-config.service';

dotenv.config({ path: '.env' });

const TEST_PASSWORD = '123456';
const MIN_BALANCE = new Prisma.Decimal(1000);

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
      country: 'BO',
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

async function main() {
  const prisma = new PrismaService(new ConfigService());
  const systemConfigService = new SystemConfigService(prisma);
  const referralsService = new ReferralsService(prisma, systemConfigService);

  await prisma.$connect();

  try {
    const runtime = await systemConfigService.getRuntimeConfig();

    // user12 = referrer
    const user12Result = await ensureUser(prisma, 'user12@gmail.com', 'Usuario', 'Doce');
    const user12Code = await referralsService.ensureUserReferralCode(user12Result.user.id);

    // user22 = referred
    const user22Result = await ensureUser(prisma, 'user22@gmail.com', 'Usuario', 'Veintidos');

    const referralLink = await referralsService.createReferralLink(user22Result.user.id, user12Code);

    const finalReferral = await prisma.referral.findUnique({
      where: { referredUserId: user22Result.user.id },
      select: {
        id: true,
        status: true,
        referrerRole: true,
        referredRole: true,
        rewardPaidAt: true,
        qualifiedAt: true,
        referrer: { select: { id: true, email: true } },
      },
    });

    const rewards = await prisma.referralReward.findMany({
      where: { referral: { referredUserId: user22Result.user.id } },
      select: {
        id: true,
        type: true,
        case: true,
        rewardAmount: true,
        currency: true,
        createdAt: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          config: { referralRewardPercent: runtime.referralRewardPercent },
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
          },
          referralLink: { id: referralLink?.id ?? finalReferral?.id ?? null },
          finalReferral,
          rewards,
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
