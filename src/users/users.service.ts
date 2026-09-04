import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, TransactionType, User, UserRole, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { createUniqueReferralCode } from '../referrals/utils/referral-code.util';
import { computeCapabilities } from '../common/capabilities';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async create(data: CreateUserDto): Promise<User> {
    try {
      const referralCode = await createUniqueReferralCode(
        this.prisma,
        data.firstName ?? data.phoneNumber,
      );

      return await this.prisma.user.create({
        data: {
          ...data,
          referralCode,
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

  async ensureReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, referralCode: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.referralCode) return user.referralCode;

    const referralCode = await createUniqueReferralCode(this.prisma, user.firstName ?? user.id.slice(0, 6));
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode },
      select: { referralCode: true },
    });

    return updated.referralCode as string;
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

    if (t.type === TransactionType.REFERRAL_REWARD) {
      return 'Recompensa por referido';
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
      where: { id: userId },
      include: {
        wallet: true,
        userProfile: true,
      },
    });

    if (!user) throw new NotFoundException('Perfil de usuario no encontrado');
    return user;
  }

  async updateMyUserProfile(
    userId: string,
    payload: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phoneNumber?: string;
      userName?: string;
      bio?: string;
      avatarUrl?: string;
      avatarPublicId?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userProfile: true, wallet: true },
    });

    if (!user) throw new NotFoundException('Perfil de usuario no encontrado');

    const email = payload.email?.trim().toLowerCase();
    const phoneNumber = payload.phoneNumber?.trim();
    const userName = payload.userName?.trim();

    if (email && email !== user.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: userId } },
        select: { id: true },
      });
      if (existingEmail) throw new ConflictException('El email ya está registrado.');
    }

    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const existingPhone = await this.prisma.user.findFirst({
        where: { phoneNumber, NOT: { id: userId } },
        select: { id: true },
      });
      if (existingPhone) throw new ConflictException('El número de teléfono ya está registrado.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
        ...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phoneNumber !== undefined ? { phoneNumber } : {}),
        userProfile: {
          upsert: {
            create: {
              userName: userName ?? user.firstName ?? `user_${userId.slice(0, 8)}`,
              ...(payload.bio !== undefined ? { bio: payload.bio } : {}),
              ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
              ...(payload.avatarPublicId !== undefined ? { avatarPublicId: payload.avatarPublicId } : {}),
            },
            update: {
              ...(userName !== undefined ? { userName } : {}),
              ...(payload.bio !== undefined ? { bio: payload.bio } : {}),
              ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
              ...(payload.avatarPublicId !== undefined ? { avatarPublicId: payload.avatarPublicId } : {}),
            },
          },
        },
      },
      include: {
        wallet: true,
        userProfile: true,
      },
    });

    return updated;
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

  // METODO PARA ELIMINAR UN USUARIO (SOFT DELETE)
  async deleteUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique(
      {
        where: { id: userId},
      }
    );

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if(user.role !== UserRole.USER){
      throw new BadRequestException('Solo se puede eliminar usuario con rol USER');
    }

    const tieneBookingActivo = await this.prisma.booking.findFirst({
      where: {
        OR: [{ clientId: userId }, { professionalId: userId }],
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] },
      },
    });

    if (tieneBookingActivo) {
      throw new BadRequestException('No se puede eliminar un usuario con bookings activos');
    }

    const tieneRetiroPendiente = await this.prisma.withdrawalRequest.findFirst({
      where: {
        wallet: {userId: userId},
        status: WithdrawalStatus.PENDING,
      },
    });

    if (tieneRetiroPendiente) {
      throw new BadRequestException('No se puede eliminar un usuario con retiro pendiente');
    }

    await this.prisma.user.delete({
      where: { id: userId },
    })
  }

  // METODO PARA ELIMINAR SIN CONSULTAR QUE COSAS TIENE EL USUARIO
  async forceDeleteUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique(
      {
        where: { id: userId},
      }
    );

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.role !== UserRole.USER) {
      throw new BadRequestException('Solo se puede eliminar usuario con rol USER');
    }

    await this.prisma.user.delete({
      where: { id: userId },
    })
  }

  // Devuelve el modo activo + capacidades del usuario. Lo usa el frontend para
  // decidir si mostrar el toggle (isProfessional) y qué modo pintar por defecto.
  async getModeContext(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        activeMode: true,
        professionalProfile: { select: { reviewStatus: true } },
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');

    const capabilities = computeCapabilities({
      role: user.role,
      hasProfessionalProfile: Boolean(user.professionalProfile),
    });

    return {
      activeMode: user.activeMode,
      capabilities,
      // Estado de la verificación profesional (útil para mostrar "pendiente de revisión").
      professionalReviewStatus: user.professionalProfile?.reviewStatus ?? null,
    };
  }

  // Cambia el modo del toggle. Cambiar a PROFESSIONAL exige tener capacidad
  // profesional (un ProfessionalProfile); si no, el frontend debe llevar al onboarding.
  async switchActiveMode(userId: string, mode: 'USER' | 'PROFESSIONAL') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        activeMode: true,
        professionalProfile: { select: { reviewStatus: true } },
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');

    const capabilities = computeCapabilities({
      role: user.role,
      hasProfessionalProfile: Boolean(user.professionalProfile),
    });

    if (mode === UserRole.PROFESSIONAL && !capabilities.isProfessional) {
      throw new BadRequestException(
        'Aún no eres profesional. Completa tu registro como profesional para activar este modo.',
      );
    }

    if (user.activeMode !== mode) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeMode: mode as UserRole },
      });
    }

    return {
      activeMode: mode,
      capabilities,
      professionalReviewStatus: user.professionalProfile?.reviewStatus ?? null,
    };
  }
}
