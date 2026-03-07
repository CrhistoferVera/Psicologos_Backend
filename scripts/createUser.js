import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {

  // encriptar contraseña
  const hashedPassword = await bcrypt.hash("123456", 10);

  const user = await prisma.user.create({
    data: {
      phoneNumber: "111342431",
      email: "saat@gmail.com",
      password: hashedPassword,
      firstName: "Juan",
      lastName: "Perez",
      role: "ADMIN"
    }
  });

  console.log("Usuario creado:", user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());