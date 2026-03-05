import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { User, Prisma } from '@prisma/client';

@Injectable()
export class UsersService {

  constructor(private prisma: PrismaService) { }
  // 1. CREAR USUARIO (Usado por AuthService en el registro)

  async create(data: CreateUserDto): Promise<User> {
    try {
      // Nota: AuthService ya debe haber hasheado la contraseña antes de llamar aquí
      return await this.prisma.user.create({
        data: {
          ...data,
          kycStatus: 'UNVERIFIED', // Estado inicial por defecto
        },
      });
    } catch (error) {
      // Manejo de error si el email ya existe (Prisma lanza código P2002)
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'El correo electrónico ya está registrado.',
          );
        }
      }
      throw new InternalServerErrorException('Error al crear el usuario.');
    }
  }

  // 2. BUSCAR POR EMAIL (Usado por AuthService en el login)
  async findOneByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findOneByResetToken(token: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { resetPasswordToken: token },
    });
  }

  // 3. BUSCAR POR WALLET ADDRESS
  async findOneByWalletAddress(walletAddress: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { walletAddress },
    });
  }

  // 4. BUSCAR POR ID (Usado para ver perfil)
  async findOneById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  // 4. ACTUALIZAR (Para subir KYC o cambiar datos)
  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }
  // 5. ACTUALIZAR ÚLTIMO LOGIN
  async updateLastLogin(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() },
    });
  }
}