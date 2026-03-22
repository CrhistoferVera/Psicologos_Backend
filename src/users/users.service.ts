import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { User, Prisma, UserRole, TransactionType } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async create(data: CreateUserDto): Promise<User> {

    try {
      return await this.prisma.user.create({
        data: {
          ...data,

          wallet: {
            create: {
              balance: 0,
            }
          },
          userProfile: {
            create: {
              userName: data.firstName ?? `user_${Math.floor(Math.random() * 10000)}`,
            }
          }


        },
        include:
        {
          wallet: true,
        },
      });

    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El teléfono o email ya está registrado.');
        }
      }
      throw new InternalServerErrorException('Error al crear el usuario.');
    }
  }

  //HISTORIAL DE GASTOS
  async findUserExpenseHistory(userId: string) {

    console.log("Buscando historial para el ID:", userId);
    // 1. Buscamos la billetera del usuario y sus transacciones
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' }, // Lo más reciente primero
          include: {
            // Detalle si fue un mensaje
            messageUnlock: {
              include: {
                message: {
                  select: {
                    sender: {
                      select: { firstName: true, lastName: true }
                    }
                  }
                }
              }
            },
            // Detalle si fue una imagen premium
            imageUnlock: {
              include: {
                image: {
                  select: {
                    profile: { select: { username: true } }
                  }
                }
              }
            },
            // Detalle si fue una recarga de créditos
            depositRequest: {
              select: {
                packageNameAtMoment: true,
                amount: true
              }
            }
          }
        }
      }
    });

    if (!wallet) {
      throw new NotFoundException('Billetera no encontrada');
    }

    // 2. Mapeamos los datos para que el Frontend reciba algo limpio
    return wallet.transactions.map(t => ({
      id: t.id,
      monto: t.amount,
      tipo: t.type,
      fecha: t.createdAt,
      descripcion: t.description,
      detalle: this.formatDetail(t)
    }));
  }

  // Función auxiliar para generar un texto descriptivo según el tipo
  private formatDetail(t: any) {
    if (t.type === 'MESSAGE_UNLOCK' || t.type === TransactionType.MESSAGE_UNLOCK ) {
      const nombreAnfitriona = `${t.messageUnlock?.message?.sender?.firstName || 'Anfitriona'}`;
      return `Mensaje desbloqueada de ${nombreAnfitriona}`;
    }
    if (t.type === 'IMAGE_UNLOCK' || t.type === TransactionType.IMAGE_UNLOCK ) {
      const nombreAnfitriona = `${t.imageUnlock?.image?.profile?.username || 'Anfitriona'}`;
      return `Foto premium de ${nombreAnfitriona}`;
    }
    if (t.type === 'DEPOSIT' || t.type === TransactionType.DEPOSIT) {
      return `Recarga: ${t.depositRequest?.packageNameAtMoment || 'Paquete de créditos'}`;
    }
    if (t.type === 'CALL_PAYMENT' || t.type === TransactionType.CALL_PAYMENT) {
      return t.description ? `Llamada: ${t.description}` : `Llamada realizada`;
    }

    if (t.type === 'EARNING' || t.type === TransactionType.EARNING) {
      return `Ingreso recibido por servicios`;
    }
    return 'Transacción general';
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

  //OBTENER DATOS DE PERFIL DE USUARIO USER, USERPROFILE Y SU WALLET
  async getUserFullProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, role: UserRole.USER },
      include: {
        wallet: true,
        userProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Perfil de usuario no encontrado');
    }

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

  //OBTENER LA WALLET DEL USUARIO, ANFITRIONA O ADMIN
  async findWalletByUserId(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId }
    });
    return wallet;
  }

  // TOGGLE GUARDAR / QUITAR ANFITRIONA
  async toggleSavedAnfitriona(userId: string, anfitrionaId: string) {
    const anfitriona = await this.prisma.user.findFirst({
      where: { id: anfitrionaId, role: UserRole.ANFITRIONA, isActive: true },
    });

    if (!anfitriona) throw new NotFoundException('Anfitriona no encontrada.');

    const existing = await this.prisma.savedAnfitriona.findUnique({
      where: { userId_anfitrionaId: { userId, anfitrionaId } },
    });

    if (existing) {
      await this.prisma.savedAnfitriona.delete({
        where: { userId_anfitrionaId: { userId, anfitrionaId } },
      });
      return { saved: false };
    }

    await this.prisma.savedAnfitriona.create({ data: { userId, anfitrionaId } });
    return { saved: true };
  }

  // LISTAR ANFITRIONAS GUARDADAS DEL CLIENTE
  async getSavedAnfitrionas(userId: string, cursor?: string, limit: number = 10) {
    const saved = await this.prisma.savedAnfitriona.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
      include: {
        anfitriona: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            anfitrionaProfile: {
              select: {
                username: true,
                avatarUrl: true,
                isOnline: true,
                rateCredits: true,
              },
            },
          },
        },
      },
    });

    let nextCursor: string | null = null;

    if (saved.length > limit) {
      saved.pop();
      nextCursor = saved[saved.length - 1].id;
    }

    return {
      data: saved.map(s => ({
        id: s.anfitriona.id,
        name: `${s.anfitriona.firstName} ${s.anfitriona.lastName}`,
        username: s.anfitriona.anfitrionaProfile?.username,
        avatar: s.anfitriona.anfitrionaProfile?.avatarUrl,
        isOnline: s.anfitriona.anfitrionaProfile?.isOnline,
        rateCredits: s.anfitriona.anfitrionaProfile?.rateCredits,
        savedAt: s.createdAt,
      })),
      nextCursor,
    };
  }

  //OBTENER LOS MEOTODOS DE PAGO
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
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener métodos de pago');
    }
  }
}
