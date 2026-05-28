import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma.service';
import { UserRole } from '@prisma/client';

function parseArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage() {
  console.log(`
Uso:
  npx ts-node scripts/fix-professional-review-status.ts
  npx ts-node scripts/fix-professional-review-status.ts --apply --userIds=id1,id2,id3

Comportamiento:
  - Sin --apply: solo muestra candidatos (dry-run).
  - Con --apply: actualiza a APPROVED unicamente los userIds indicados,
    y solo si hoy cumplen: rol profesional, isActive=true y reviewStatus=PENDING.
`);
}

async function main() {
  const apply = hasFlag('--apply');
  const userIdsArg = parseArg('--userIds');
  const selectedUserIds = userIdsArg
    ? userIdsArg
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  const prisma = new PrismaService(new ConfigService());
  await prisma.$connect();

  const candidates = await prisma.user.findMany({
    where: {
      role: { in: [UserRole.PROFESSIONAL] },
      isActive: true,
      isProfileComplete: true,
      professionalProfile: {
        is: {
          reviewStatus: 'PENDING',
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      professionalProfile: {
        select: {
          username: true,
          reviewStatus: true,
        },
      },
    },
  });

  console.log(`Candidatos (isActive=true + reviewStatus=PENDING): ${candidates.length}`);
  candidates.forEach((u) => {
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || '(sin nombre)';
    console.log(
      `- ${u.id} | ${fullName} | ${u.professionalProfile?.username ?? '(sin username)'} | ${u.createdAt.toISOString()}`,
    );
  });

  if (!apply) {
    await prisma.$disconnect();
    return;
  }

  if (selectedUserIds.length === 0) {
    printUsage();
    throw new Error('Debes enviar --userIds=id1,id2 para aplicar cambios.');
  }

  const validTargets = candidates
    .filter((u) => selectedUserIds.includes(u.id))
    .map((u) => u.id);

  if (validTargets.length === 0) {
    await prisma.$disconnect();
    console.log('No hay targets validos para actualizar.');
    return;
  }

  const result = await prisma.professionalProfile.updateMany({
    where: {
      userId: { in: validTargets },
      reviewStatus: 'PENDING',
      user: {
        isActive: true,
        isProfileComplete: true,
        role: { in: [UserRole.PROFESSIONAL] },
      },
    },
    data: {
      reviewStatus: 'APPROVED',
    },
  });

  console.log(`Actualizados: ${result.count}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
