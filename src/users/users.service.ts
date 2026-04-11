import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateUserDto): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          ...data,
          wallet: {
            create: {
              balance: 10,
              promotionalBalance: 10,
              transactions: {
                create: {
                  amount: 10,
                  promotionalAmount: 10,
                  realAmount: 0,
                  isPromotional: true,
                  type: TransactionType.PROMOTIONAL_GRANT,
                  description: 'Regalo de bienvenida - 10 creditos',
                },
              },
            },
          },
          userProfile: {
            create: {
              userName: data.firstName ?? `user_${Math.floor(Math.random() * 10000)}`,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El telefono o email ya esta registrado.');
      }
      throw new InternalServerErrorException('Error al crear el usuario.');
    }
  }

  async findUserExpenseHistory(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          include: {
            depositRequest: {
              select: {
                packageNameAtMoment: true,
                amount: true,
              },
            },
          },
        },
      },
    });

    if (!wallet) throw new NotFoundException('Billetera no encontrada');

    return wallet.transactions.map((t) => ({
      id: t.id,
      monto: Number(t.amount),
      tipo: t.type,
      fecha: t.createdAt,
      descripcion: t.description,
      detalle: this.formatDetail(t),
      promotionalAmount: Number(t.promotionalAmount),
      realAmount: Number(t.realAmount),
      isPromotional: t.isPromotional,
    }));
  }

  private formatDetail(t: {
    type: TransactionType;
    description: string | null;
    depositRequest?: { packageNameAtMoment: string | null } | null;
  }) {
    if (t.type === TransactionType.DEPOSIT) {
      return `Recarga: ${t.depositRequest?.packageNameAtMoment || 'Paquete de creditos'}`;
    }

    if (t.type === TransactionType.PROMOTIONAL_GRANT) {
      return 'Creditos promocionales/regalo';
    }

    if (t.type === TransactionType.CALL_PAYMENT) {
      return t.description ? `Llamada: ${t.description}` : 'Llamada realizada';
    }

    if (t.type === TransactionType.MESSAGE_SEND) {
      return 'Envio de mensaje';
    }

    if (t.type === TransactionType.WITHDRAWAL) {
      return 'Retiro de saldo';
    }

    if (t.type === TransactionType.EARNING) {
      return 'Ingreso recibido por servicios';
    }

    return 'Transaccion general';
  }

  async findOneByPhone(phoneNumber: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phoneNumber } });
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }

  async findOneById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getUserFullProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, role: UserRole.USER },
      include: {
        wallet: true,
        userProfile: true,
      },
    });

    if (!user) throw new NotFoundException('Perfil de usuario no encontrado');
    return user;
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() },
    });
  }

  async findWalletByUserId(userId: string) {
    return this.prisma.wallet.findUnique({ where: { userId } });
  }

  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    if (!fcmToken || fcmToken.trim().length === 0) return;

    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: fcmToken.trim() },
    });
  }

  async findAllActive() {
    try {
      return await this.prisma.paymentMethod.findMany({
        where: { isActive: true },
        select: {
          id: true,
          type: true,
          bankName: true,
          accountName: true,
          accountNumber: true,
          qrImageUrl: true,
          logoUrl: true,
        },
      });
    } catch {
      throw new InternalServerErrorException('Error al obtener metodos de pago');
    }
  }
}
