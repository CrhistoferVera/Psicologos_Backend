import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const hashedPassword = await bcrypt.hash("12345678", 10);

const camposBOB = {
  phoneDialCode: "+591",
  phoneCountryIso: "BO",
  phoneCountryName: "Bolivia",
  billingRegion: "BO",
  preferredCurrency: "BOB",
};

const camposUSD = {
  phoneDialCode: "+1",
  phoneCountryIso: "US",
  phoneCountryName: "United States",
  billingRegion: "US",
  preferredCurrency: "USD",
};

const usuariosBOB = [
  { email: "cliente_bob1@test.com", phoneNumber: "+59179100001", phoneNationalNumber: "79100001", firstName: "Cliente", lastName: "Bob1", ...camposBOB },
  { email: "cliente_bob2@test.com", phoneNumber: "+59179100002", phoneNationalNumber: "79100002", firstName: "Cliente", lastName: "Bob2", ...camposBOB },
  { email: "cliente_bob3@test.com", phoneNumber: "+59179100003", phoneNationalNumber: "79100003", firstName: "Cliente", lastName: "Bob3", ...camposBOB },
];

const usuariosUSD = [
  { email: "cliente_usd1@test.com", phoneNumber: "+59179100004", phoneNationalNumber: "79100004", firstName: "Cliente", lastName: "Usd1", ...camposUSD },
  { email: "cliente_usd2@test.com", phoneNumber: "+59179100005", phoneNationalNumber: "79100005", firstName: "Cliente", lastName: "Usd2", ...camposUSD },
  { email: "cliente_usd3@test.com", phoneNumber: "+59179100006", phoneNationalNumber: "79100006", firstName: "Cliente", lastName: "Usd3", ...camposUSD },
];

async function upsertUsuario(data, walletData) {
  const user = await prisma.user.upsert({
    where: { email: data.email },
    update: {
      ...data,
      password: hashedPassword,
      isProfileComplete: true,
      wallet: {
        upsert: {
          create: { promotionalBalance: 0, ...walletData },
          update: walletData,
        },
      },
    },
    create: {
      ...data,
      password: hashedPassword,
      role: "USER",
      isProfileComplete: true,
      wallet: { create: { promotionalBalance: 0, ...walletData } },
    },
  });
  return user;
}

async function main() {
  console.log("Actualizando/creando usuarios con 1200 BOB...");
  for (const data of usuariosBOB) {
    const user = await upsertUsuario(data, { balance: 1200, balanceUsd: 0 });
    console.log(`  ✓ ${user.email}`);
  }

  console.log("Actualizando/creando usuarios con 120 USD...");
  for (const data of usuariosUSD) {
    const user = await upsertUsuario(data, { balance: 0, balanceUsd: 120 });
    console.log(`  ✓ ${user.email}`);
  }

  console.log("Listo. 6 usuarios procesados.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
