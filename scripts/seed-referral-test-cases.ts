/**
 * Crea usuarios de prueba para los 3 casos de referidos.
 *
 * Caso 1: Pro A refiere a Pro B  (recompensa recurrente por cada sesión de B)
 * Caso 2: Pro A refiere a Cliente C  (recompensa una sola vez)
 * Caso 3: Cliente D refiere a Cliente E  (recompensa una sola vez)
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/seed-referral-test-cases.ts
 */

import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { PrismaService } from '../src/prisma.service';
import { ReferralsService } from '../src/referrals/referrals.service';
import { SystemConfigService } from '../src/system-config/system-config.service';

dotenv.config({ path: '.env' });

const PASSWORD = '123456';
const BALANCE = new Prisma.Decimal(500);

// ─── helpers ──────────────────────────────────────────────────────────────────

const PHONE_MAP: Record<string, string> = {
  'pro.a2@test.com':           '72000001',
  'pro.b2@test.com':           '72000002',
  'cliente.c2@test.com':       '72000003',
  'cliente.d2@test.com':       '72000004',
  'cliente.e2@test.com':       '72000005',
  'extranjero.f2@test.com':    '72000006',
  'extranjero.g2@test.com':    '72000007',
};

async function upsertUser(
  prisma: PrismaService,
  opts: {
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    foreign?: boolean;
  },
) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) {
    console.log(`  [skip] ${opts.email} ya existe (id=${existing.id})`);
    return existing;
  }

  const hash = await bcrypt.hash(PASSWORD, 10);
  const phone = PHONE_MAP[opts.email] ?? ('799' + Math.floor(Math.random() * 99999).toString().padStart(5, '0'));

  const isForeign = opts.foreign ?? false;

  const user = await prisma.user.create({
    data: {
      email: opts.email,
      password: hash,
      firstName: opts.firstName,
      lastName: opts.lastName,
      role: opts.role,
      isActive: true,
      isProfileComplete: true,
      phoneNumber: phone,
      phoneDialCode: isForeign ? '+1' : '+591',
      phoneCountryIso: isForeign ? 'US' : 'BO',
      phoneCountryName: isForeign ? 'United States' : 'Bolivia',
      billingRegion: isForeign ? 'INTERNATIONAL' : 'BOLIVIA',
      preferredCurrency: isForeign ? 'USD' : 'BOB',
      wallet: {
        create: {
          balance: BALANCE,
          promotionalBalance: new Prisma.Decimal(0),
          balanceUsd: BALANCE,
        },
      },
      ...(opts.role === UserRole.PROFESSIONAL || opts.role === UserRole.ANFITRIONA
        ? {
            professionalProfile: {
              create: {
                username: opts.email.split('@')[0],
                reviewStatus: 'APPROVED',
              },
            },
          }
        : {
            userProfile: { create: {} },
          }),
    },
  });

  console.log(`  [creado] ${opts.email} id=${user.id} rol=${user.role}`);
  return user;
}

async function linkReferral(
  referralsService: ReferralsService,
  referrerId: string,
  referredId: string,
  label: string,
) {
  const code = await referralsService.ensureUserReferralCode(referrerId);
  try {
    const ref = await referralsService.createReferralLink(referredId, code);
    console.log(`  [referido] ${label} referralId=${ref.id} code=${code}`);
    return ref;
  } catch (e: any) {
    console.log(`  [skip referido] ${label} — ${e.message}`);
    return null;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaService(new ConfigService());
  const systemConfig = new SystemConfigService(prisma);
  const referrals = new ReferralsService(prisma, systemConfig);

  await prisma.$connect();

  try {
    console.log('\n══════════════════════════════════════');
    console.log('  CASO 1 — Pro A refiere a Pro B');
    console.log('══════════════════════════════════════');
    const proA = await upsertUser(prisma, {
      email: 'pro.a2@test.com',
      firstName: 'Profesional',
      lastName: 'A2',
      role: UserRole.PROFESSIONAL,
    });
    const proB = await upsertUser(prisma, {
      email: 'pro.b2@test.com',
      firstName: 'Profesional',
      lastName: 'B2',
      role: UserRole.PROFESSIONAL,
    });
    await linkReferral(referrals, proA.id, proB.id, 'ProA2→ProB2');

    console.log('\n══════════════════════════════════════');
    console.log('  CASO 2 — Pro A2 refiere a Cliente C2');
    console.log('══════════════════════════════════════');
    const clienteC = await upsertUser(prisma, {
      email: 'cliente.c2@test.com',
      firstName: 'Cliente',
      lastName: 'C2',
      role: UserRole.USER,
    });
    await linkReferral(referrals, proA.id, clienteC.id, 'ProA2→ClienteC2');

    console.log('\n══════════════════════════════════════');
    console.log('  CASO 3 — Cliente D2 refiere a Cliente E2');
    console.log('══════════════════════════════════════');
    const clienteD = await upsertUser(prisma, {
      email: 'cliente.d2@test.com',
      firstName: 'Cliente',
      lastName: 'D2',
      role: UserRole.USER,
    });
    const clienteE = await upsertUser(prisma, {
      email: 'cliente.e2@test.com',
      firstName: 'Cliente',
      lastName: 'E2',
      role: UserRole.USER,
    });
    await linkReferral(referrals, clienteD.id, clienteE.id, 'ClienteD2→ClienteE2');

    console.log('\n══════════════════════════════════════');
    console.log('  CASO 4 — Extranjero F2 referido por Pro A2 (USD, caso 2)');
    console.log('══════════════════════════════════════');
    const extF = await upsertUser(prisma, {
      email: 'extranjero.f2@test.com',
      firstName: 'John',
      lastName: 'F2',
      role: UserRole.USER,
      foreign: true,
    });
    await linkReferral(referrals, proA.id, extF.id, 'ProA2→ExtranjerоF2');

    console.log('\n══════════════════════════════════════');
    console.log('  CASO 5 — Extranjero G2 referido por Cliente D2 (USD, caso 3)');
    console.log('══════════════════════════════════════');
    const extG = await upsertUser(prisma, {
      email: 'extranjero.g2@test.com',
      firstName: 'Jane',
      lastName: 'G2',
      role: UserRole.USER,
      foreign: true,
    });
    await linkReferral(referrals, clienteD.id, extG.id, 'ClienteD2→ExtranjerоG2');

    console.log('\n══════════════════════════════════════');
    console.log('  RESUMEN');
    console.log('══════════════════════════════════════');
    console.log(`  pro.a2@test.com          id=${proA.id}    contraseña=${PASSWORD}  (BOB)`);
    console.log(`  pro.b2@test.com          id=${proB.id}    contraseña=${PASSWORD}  (BOB)`);
    console.log(`  cliente.c2@test.com      id=${clienteC.id} contraseña=${PASSWORD}  (BOB)`);
    console.log(`  cliente.d2@test.com      id=${clienteD.id} contraseña=${PASSWORD}  (BOB)`);
    console.log(`  cliente.e2@test.com      id=${clienteE.id} contraseña=${PASSWORD}  (BOB)`);
    console.log(`  extranjero.f2@test.com   id=${extF.id} contraseña=${PASSWORD}  (USD)`);
    console.log(`  extranjero.g2@test.com   id=${extG.id} contraseña=${PASSWORD}  (USD)`);

    const referralsCreated = await prisma.referral.findMany({
      where: {
        referredUserId: { in: [proB.id, clienteC.id, clienteE.id, extF.id, extG.id] },
      },
      select: {
        id: true,
        referrerRole: true,
        referredRole: true,
        status: true,
        referrer: { select: { email: true } },
        referred: { select: { email: true } },
      },
    });

    console.log('\n  Referidos en DB:');
    for (const r of referralsCreated) {
      console.log(
        `    ${r.referrer.email} → ${r.referred.email}  caso=${r.referrerRole}→${r.referredRole}  status=${r.status}`,
      );
    }
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
