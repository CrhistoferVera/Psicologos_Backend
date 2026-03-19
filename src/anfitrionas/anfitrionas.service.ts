import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';
import { CreateHistoryDto } from './dto/create-history.dto';
import { UpdateAnfitrioneProfileDto } from './dto/update-anfitriona-profile.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AnfitrionePublicListItemDto,
  AnfitrionePublicListResponseDto,
} from './dto/anfitriona-public-list.dto';
import { AnfitrionePublicDetailDto } from './dto/anfitriona-public-detail.dto';
import { HistoryFeedResponseDto } from './dto/history-feed.dto';
import { CreateWalletDto } from './dto/create-wallet.dto';

@Injectable()
export class AnfitrioneService {

  private readonly logger = new Logger(AnfitrioneService.name);

  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) { }

  async create(dto: CreateAnfitrioneDto, idDocFile?: Express.Multer.File) {
    // Verificar unicidad antes de crear
    const [existingPhone, existingCedula, existingUsername, existingEmail] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } }),
        this.prisma.anfitrioneProfile.findUnique({ where: { cedula: dto.cedula } }),
        this.prisma.anfitrioneProfile.findUnique({ where: { username: dto.username } }),
        dto.email
          ? this.prisma.user.findUnique({ where: { email: dto.email } })
          : Promise.resolve(null),
      ]);

    if (existingPhone)
      throw new ConflictException('El número de teléfono ya está registrado.');
    if (existingCedula)
      throw new ConflictException('La cédula ya está registrada.');
    if (existingUsername)
      throw new ConflictException('El nombre de usuario ya está en uso.');
    if (existingEmail)
      throw new ConflictException('El email ya está registrado.');

    // Crear usuario con role ANFITRIONA
    let user: Awaited<ReturnType<typeof this.prisma.user.create>>;
    try {
      user = await this.prisma.user.create({
        data: {
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'ANFITRIONA',
          isProfileComplete: true,

          wallet: {
            create: {
              balance: 0,
            }
          }
        },

        include: {
          wallet: true,
        }
      });

      this.logger.log(`✅ Anfitriona creada con ID: ${user.id} y Wallet vinculada.`);

    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un usuario con esos datos.');
      }
      throw new InternalServerErrorException('Error al crear la anfitriona.');
    }

    // Subir documento de identidad si se proporcionó
    let idDocUrl: string | null = null;
    let idDocPublicId: string | null = null;

    if (idDocFile) {
      try {
        const uploaded = await this.cloudinary.uploadAnfitrioneIdDoc({
          file: idDocFile,
          userId: user.id,
        });
        idDocUrl = uploaded.secureUrl;
        idDocPublicId = uploaded.publicId;
      } catch {
        // Rollback: eliminar usuario si falla la subida
        await this.prisma.user.delete({ where: { id: user.id } });
        throw new InternalServerErrorException(
          'Error al subir el documento de identidad.',
        );
      }
    }

    // Crear perfil de anfitriona
    const profile = await this.prisma.anfitrioneProfile.create({
      data: {
        userId: user.id,
        dateOfBirth: new Date(dto.dateOfBirth),
        cedula: dto.cedula,
        username: dto.username,
        idDocUrl,
        idDocPublicId,
      },
    });

    const { password: _, resetPasswordToken: __, resetPasswordExpiry: ___, ...safeUser } = user;

    return { user: safeUser, profile };
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { role: 'ANFITRIONA' },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        firstName: true,
        lastName: true,
        isProfileComplete: true,
        createdAt: true,
        anfitrionaProfile: true,
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        firstName: true,
        lastName: true,
        isProfileComplete: true,
        createdAt: true,
        anfitrionaProfile: true,
      },
    });
  }

  //CREAR UNA HISTORIA PARA UNA ANFITRIONA
  async createHistory(userId: string, createHistoryDto: CreateHistoryDto, file: Express.Multer.File,) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new NotFoundException(`Anfitriona con ID ${userId} no encontrada`);
    }

    if (user.role !== UserRole.ANFITRIONA) {
      throw new NotFoundException('solo las anfitrionas pueden tener historias');
    }

    const upload = await this.cloudinary.uploadHistoryMedia({
      file,
      userId,
    });

    return this.prisma.history.create({
      data: {
        userId: user.id,
        mediaUrl: upload.secureUrl,
        publicId: upload.publicId,
        mediaType: upload.resourceType.toUpperCase() as MediaType,
        priceCredits: createHistoryDto.priceCredits,
        publishedAt: new Date(),
      },
    });
  }

  //ELIMINAR UNA HISTORIA DE UNA ANFITRIONA
  async deleteHistory(userId: string, historyId: string) {
    // Verificar que la historia exista y pertenezca a la anfitriona que solicita
    const history = await this.prisma.history.findUnique({
      where: {
        id: historyId,
        userId: userId,
      },
    });

    if (!history) {
      throw new NotFoundException(
        `No se encontró la historia o no tienes permiso para eliminarla.`,
      );
    }

    const resourceType = history.mediaType.toLowerCase() as 'image' | 'video';
    const publicId = history.publicId;

    // Eliminar archivo físico de Cloudinary
    if (publicId) {
      await this.cloudinary.deleteHistoryMedia(publicId, resourceType);

    }
    // Eliminar registro de la base de datos Prisma
    return this.prisma.history.delete({
      where: { id: historyId },
    });
  }

  //24 HORAS DESPUES DE PUBLICADA, LA HISTORIA SE ELIMINA AUTOMATICAMENTE (TAREA PROGRAMADA)
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron() {

    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() - 24);

    const expiredHistories = await this.prisma.history.findMany({
      where: {
        publishedAt: {
          lt: expirationDate, // lt = Less Than (menor que la fecha de expiración)
        },
      },
      select: {
        id: true,
        mediaType: true,
        publicId: true,
      }
    });

    if (expiredHistories.length === 0) return;

    for (const history of expiredHistories) {
      try {
        const resourceType = history.mediaType.toLowerCase() as 'image' | 'video';

        if (history.publicId) {
          await this.cloudinary.deleteHistoryMedia(history.publicId, resourceType);
        }

        await this.prisma.history.delete({
          where: { id: history.id },
        });

        console.log(`Historia ${history.id} eliminada automáticamente por expiración.`);
      } catch (error) {
        console.error(`Error al eliminar historia expirada ${history.id}:`, error);
      }
    }
  }

  //OBTENER TODAS LAS HISTORIAS DE UNA ANFITRIONA
  async findAllStories(userId: string) {

    if (!userId) {
      throw new BadRequestException('No se proporcionó un ID de usuario válido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    // Buscamos sus historias ordenadas por fecha de publicación (descendente)
    return this.prisma.history.findMany({
      where: { userId: userId },
      orderBy: {
        publishedAt: 'desc',
      },
      select: {
        id: true,
        mediaUrl: true,
        mediaType: true,
        priceCredits: true,
        publishedAt: true,
      },
    });
  }

  //OBTENER LAS HISTORIAS (SOLO ACTIVAS DENTRO DE LAS 24 HRS) DE LAS ANFITRIONAS TIPO WHASAT 
  async findAllActiveStories() {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const anfitrionasWithStories = await this.prisma.user.findMany({
      where: {
        role: 'ANFITRIONA',
        isActive: true,
        histories: {
          some: {
            publishedAt: { gte: twentyFourHoursAgo }
          }
        }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        anfitrionaProfile: {
          select: { avatarUrl: true }
        },
        histories: {
          where: {
            publishedAt: { gte: twentyFourHoursAgo }
          },
          orderBy: { publishedAt: 'asc' },
          select: {
            id: true,
            mediaUrl: true,
            mediaType: true,
            priceCredits: true,
          }
        }
      }
    });

    return anfitrionasWithStories.map(u => ({
      userId: u.id,
      name: u.firstName,
      avatar: u.anfitrionaProfile?.avatarUrl,
      stories: u.histories
    }));
  }

  //SERVICIO PARA MARCAR COMO VISTO UNA HISTORIA PARA UN USUARIO
  async markAsViewed(userId: string, historyId: string) {
    try {
      const view = await this.prisma.historyView.upsert({
        where: { userId_historyId: { userId, historyId } },
        update: {},
        create: { userId, historyId }
      });
      console.log(`[DB] Vista registrada con éxito: User ${userId} -> History ${historyId}`);
      return view;
    } catch (error) {
      console.error(`[DB Error] No se pudo marcar la vista:`, error.message);
      throw new InternalServerErrorException('Error al registrar la visualización');
    }
  }

  //SERVICIO PARA MARCAR CON UN CIRCULO ROJO SI NO VIO LA HISTORIA SI Y VIO ENTONCES CON BLANCO
  async getStoriesFeed(currentUserId: string): Promise<HistoryFeedResponseDto> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const feeds = await this.prisma.user.findMany({
      where: {
        role: 'ANFITRIONA',
        isActive: true,
        histories: {
          some: { publishedAt: { gte: twentyFourHoursAgo } }
        }
      },
      select: {
        id: true,
        firstName: true,
        anfitrionaProfile: { select: { avatarUrl: true } },
        histories: {
          where: { publishedAt: { gte: twentyFourHoursAgo } },
          orderBy: { publishedAt: 'asc' }, // Orden para que el visor las pase en orden
          select: {
            id: true,
            mediaUrl: true,
            mediaType: true,
            priceCredits: true,
            publishedAt: true,
            historyViews: {
              where: { userId: currentUserId }
            }
          }
        }
      }
    });

    const data = feeds.map(anf => {
      const hasUnseen = anf.histories.some(h => h.historyViews.length === 0);

      return {
        userId: anf.id,
        name: anf.firstName || 'Anfitriona',
        avatar: anf.anfitrionaProfile?.avatarUrl ?? null,
        hasUnseen,
        totalStories: anf.histories.length,

        stories: anf.histories.map(h => ({
          id: h.id,
          mediaUrl: h.mediaUrl,
          mediaType: h.mediaType,
          priceCredits: h.priceCredits,
          publishedAt: h.publishedAt.toISOString(),
          isViewed: h.historyViews.length > 0
        }))
      };
    });

    return { data };
  }

  // ─── Public endpoints (cliente-facing) ────────────────────────────────────

  async findAllPublic(page = 1, limit = 10): Promise<AnfitrionePublicListResponseDto> {
    const where = {
      role: 'ANFITRIONA' as const,
      isActive: true,
      isProfileComplete: true,
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [
          { anfitrionaProfile: { isOnline: 'desc' } },
          { receivedLikes: { _count: 'desc' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          _count: { select: { receivedLikes: true } },
          anfitrionaProfile: {
            select: {
              username: true,
              avatarUrl: true,
              bio: true,
              rateCredits: true,
              isOnline: true,
              images: {
                select: { url: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data: AnfitrionePublicListItemDto[] = users.map((u) => {
      const profile = u.anfitrionaProfile;
      const imageUrls = profile?.images.map((img) => img.url) ?? [];

      return {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' '),
        username: profile?.username ?? null,
        avatar: profile?.avatarUrl ?? null,
        shortDescription: profile?.bio ?? null,
        rateCredits: profile?.rateCredits ?? null,
        mainImage: imageUrls[0] ?? null,
        images: imageUrls,
        isOnline: profile?.isOnline ?? false,
        likesCount: u._count.receivedLikes,
      };
    });

    return { data, total, page, limit };
  }

  async findOnePublic(id: string, currentUserId?: string): Promise<AnfitrionePublicDetailDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: 'ANFITRIONA',
        isActive: true,
        isProfileComplete: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: { select: { receivedLikes: true } },
        anfitrionaProfile: {
          select: {
            username: true,
            dateOfBirth: true,
            avatarUrl: true,
            bio: true,
            rateCredits: true,
            isOnline: true,
            images: {
              select: { url: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Anfitriona no encontrada.');
    }

    const profile = user.anfitrionaProfile;
    const age = profile?.dateOfBirth
      ? this.calculateAge(profile.dateOfBirth)
      : null;
    const imageUrls = profile?.images.map((img) => img.url) ?? [];

    let isLiked = false;
    if (currentUserId) {
      const existing = await this.prisma.like.findUnique({
        where: { userId_anfitrionaId: { userId: currentUserId, anfitrionaId: id } },
      });
      isLiked = !!existing;
    }

    return {
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      username: profile?.username ?? '',
      age,
      bio: profile?.bio ?? null,
      avatar: profile?.avatarUrl ?? null,
      coverImage: imageUrls[0] ?? null,
      images: imageUrls,
      rateCredits: profile?.rateCredits ?? null,
      isOnline: profile?.isOnline ?? false,
      likesCount: user._count.receivedLikes,
      isLiked,
    };
  }

  // ─── Own profile (anfitriona-facing) ──────────────────────────────────────

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        anfitrionaProfile: {
          select: {
            username: true,
            bio: true,
            rateCredits: true,
            isOnline: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.anfitrionaProfile?.username ?? '',
      bio: user.anfitrionaProfile?.bio ?? '',
      rateCredits: user.anfitrionaProfile?.rateCredits ?? 0,
      isOnline: user.anfitrionaProfile?.isOnline ?? false,
      avatarUrl: user.anfitrionaProfile?.avatarUrl ?? null,
    };
  }

  async updateMyProfile(
    userId: string,
    dto: UpdateAnfitrioneProfileDto,
    avatarFile?: Express.Multer.File,
  ) {
    // Check username uniqueness if changing it
    if (dto.username) {
      const conflict = await this.prisma.anfitrioneProfile.findFirst({
        where: { username: dto.username, NOT: { userId } },
      });
      if (conflict) throw new ConflictException('El nombre de usuario ya está en uso.');
    }

    // Upload avatar if provided
    let avatarUpdate: { avatarUrl: string; avatarPublicId: string } | undefined;
    if (avatarFile) {
      const uploaded = await this.cloudinary.uploadAnfitrioneAvatar({
        file: avatarFile,
        userId,
      });
      avatarUpdate = { avatarUrl: uploaded.secureUrl, avatarPublicId: uploaded.publicId };
    }

    // Update user fields
    const { firstName, lastName, ...profileFields } = dto;

    if (firstName !== undefined || lastName !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
        },
      });
    }

    // Build profile data patch
    const profileData: any = {};
    if (profileFields.username !== undefined) profileData.username = profileFields.username;
    if (profileFields.bio !== undefined) profileData.bio = profileFields.bio;
    if (profileFields.rateCredits !== undefined) profileData.rateCredits = profileFields.rateCredits;
    if (avatarUpdate) {
      profileData.avatarUrl = avatarUpdate.avatarUrl;
      profileData.avatarPublicId = avatarUpdate.avatarPublicId;
    }

    if (Object.keys(profileData).length > 0) {
      // upsert: si el perfil no existe aún (usuario creado sin perfil) lo crea al vuelo
      const usernameForCreate = profileData.username ?? `user_${userId.slice(0, 8)}`;
      await this.prisma.anfitrioneProfile.upsert({
        where: { userId },
        update: profileData,
        create: {
          userId,
          username: usernameForCreate,
          dateOfBirth: new Date('2000-01-01'),
          cedula: `auto_${userId}`,
          ...profileData,
        },
      });
    }

    return this.getMyProfile(userId);
  }

  // ─── Likes ─────────────────────────────────────────────────────────────────

  async toggleLike(userId: string, anfitrionaId: string): Promise<{ liked: boolean; likesCount: number }> {
    // Verify the target is an active anfitriona
    const anfitriona = await this.prisma.user.findFirst({
      where: { id: anfitrionaId, role: 'ANFITRIONA', isActive: true },
    });
    if (!anfitriona) {
      throw new NotFoundException('Anfitriona no encontrada.');
    }

    const existing = await this.prisma.like.findUnique({
      where: { userId_anfitrionaId: { userId, anfitrionaId } },
    });

    if (existing) {
      await this.prisma.like.delete({
        where: { userId_anfitrionaId: { userId, anfitrionaId } },
      });
    } else {
      await this.prisma.like.create({
        data: { userId, anfitrionaId },
      });
    }

    const likesCount = await this.prisma.like.count({ where: { anfitrionaId } });
    return { liked: !existing, likesCount };
  }

  private calculateAge(dateOfBirth: Date): number {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    return age;
  }
}
