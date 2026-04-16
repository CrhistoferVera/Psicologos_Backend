import { PrismaClient } from '@prisma/client';

function sanitizeSeed(seed?: string): string {
  if (!seed) return '';

  return seed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function randomSuffix(length = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';

  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return output;
}

export async function createUniqueReferralCode(
  prisma: Pick<PrismaClient, 'user'>,
  seed?: string,
): Promise<string> {
  const base = sanitizeSeed(seed) || 'PSY';

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `${base}${randomSuffix(4)}`;

    const exists = await prisma.user.findFirst({
      where: { referralCode: candidate },
      select: { id: true },
    });

    if (!exists) return candidate;
  }

  return `${base}${Date.now().toString(36).toUpperCase().slice(-6)}`;
}
