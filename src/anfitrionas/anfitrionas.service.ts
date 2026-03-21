import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { GalleryImageDto, GalleryImagePublicDto } from './dto/gallery-image.dto';

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
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let user: Awaited<ReturnType<typeof this.prisma.user.create>>;
    try {
      user = await this.prisma.user.create({
        data: {
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          password: hashedPassword,
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

  async findAllPublic(page = 1, limit = 10, currentUserId?: string): Promise<AnfitrionePublicListResponseDto> {
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
                where: { isVisible: true },
                select: { url: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Fetch all likes by the current user in a single query to avoid N+1
    let likedIds = new Set<string>();
    if (currentUserId && users.length > 0) {
      const anfitrionaIds = users.map((u) => u.id);
      const userLikes = await this.prisma.like.findMany({
        where: { userId: currentUserId, anfitrionaId: { in: anfitrionaIds } },
        select: { anfitrionaId: true },
      });
      likedIds = new Set(userLikes.map((l) => l.anfitrionaId));
    }

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
        isLiked: likedIds.has(u.id),
      };
    });

    data.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return (b.likesCount ?? 0) - (a.likesCount ?? 0);
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
              where: { isVisible: true },
              select: { id: true, url: true, isPremium: true, unlockCredits: true },
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

    const rawImages = profile?.images ?? [];

    // Si hay usuario autenticado, averiguar qué imágenes ya desbloqueó — un solo query
    let unlockedImageIds = new Set<string>();
    if (currentUserId && rawImages.length > 0) {
      const imageIds = rawImages.map((img) => img.id);
      const unlocks = await this.prisma.imageUnlock.findMany({
        where: { userId: currentUserId, imageId: { in: imageIds } },
        select: { imageId: true },
      });
      unlockedImageIds = new Set(unlocks.map((u) => u.imageId));
    }

    const galleryImages: GalleryImagePublicDto[] = rawImages.map((img) => ({
      id: img.id,
      imageUrl: img.url,
      isPremium: img.isPremium,
      unlockCredits: img.isPremium ? img.unlockCredits : null,
      // true solo cuando la imagen es premium Y el viewer ya la pagó
      isUnlockedByViewer: img.isPremium ? unlockedImageIds.has(img.id) : false,
    }));

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
      coverImage: galleryImages[0]?.imageUrl ?? null,
      images: galleryImages.map((img) => img.imageUrl),
      galleryImages,
      rateCredits: profile?.rateCredits ?? null,
      isOnline: profile?.isOnline ?? false,
      likesCount: user._count.receivedLikes,
      isLiked,
    };
  }

  // ─── Desbloqueo de imagen premium (HU: desbloquear imagen premium) ─────────

  /**
   * Permite a un cliente (USER) desbloquear una imagen premium.
   * Sigue el mismo patrón atómico que unlockMessage():
   *   1. Verifica imagen y anfitriona
   *   2. Idempotencia: si ya fue desbloqueada devuelve confirmación sin cobrar
   *   3. Verifica wallets y saldo
   *   4. Transacción atómica: débito cliente + crédito anfitriona + registros
   *   5. Crea ImageUnlock
   */
  async unlockGalleryImage(
    clientUserId: string,
    anfitrionaId: string,
    imageId: string,
  ): Promise<{ alreadyUnlocked: boolean; creditsSpent: number; imageUrl: string }> {
    // 1. Verificar que la anfitriona exista y esté activa
    const anfitriona = await this.prisma.user.findFirst({
      where: { id: anfitrionaId, role: 'ANFITRIONA', isActive: true },
    });
    if (!anfitriona) throw new NotFoundException('Anfitriona no encontrada.');

    // 2. Verificar que la imagen exista, sea visible y pertenezca a esa anfitriona
    const image = await this.prisma.anfitrioneImage.findFirst({
      where: {
        id: imageId,
        isVisible: true,
        profile: { userId: anfitrionaId },
      },
    });
    if (!image) throw new NotFoundException('Imagen no encontrada.');

    // 3. Verificar que la imagen sea premium
    if (!image.isPremium || !image.unlockCredits) {
      throw new BadRequestException('Esta imagen no es premium y no requiere desbloqueo.');
    }

    // 4. Idempotencia: si ya está desbloqueada, no cobrar de nuevo
    const existing = await this.prisma.imageUnlock.findUnique({
      where: { imageId_userId: { imageId, userId: clientUserId } },
    });
    if (existing) {
      return { alreadyUnlocked: true, creditsSpent: 0, imageUrl: image.url };
    }

    const creditsRequired = image.unlockCredits;

    // 5. Wallet del cliente
    const clientWallet = await this.prisma.wallet.findUnique({
      where: { userId: clientUserId },
    });
    if (!clientWallet) throw new NotFoundException('Wallet del cliente no encontrada.');
    if (Number(clientWallet.balance) < creditsRequired) {
      throw new BadRequestException('Créditos insuficientes para desbloquear esta imagen.');
    }

    // 6. Wallet de la anfitriona
    const anfitrionaWallet = await this.prisma.wallet.findUnique({
      where: { userId: anfitrionaId },
    });
    if (!anfitrionaWallet) {
      throw new NotFoundException('Wallet de la anfitriona no encontrada.');
    }

    // 7. Transacción atómica: débito cliente + crédito anfitriona
    const [, clientTx] = await this.prisma.$transaction([
      // Débito al cliente
      this.prisma.wallet.update({
        where: { userId: clientUserId },
        data: { balance: { decrement: creditsRequired } },
      }),
      // Registro de movimiento del cliente
      this.prisma.transaction.create({
        data: {
          walletId: clientWallet.id,
          type: 'IMAGE_UNLOCK',
          amount: creditsRequired,
          description: `Desbloqueo de imagen premium`,
        },
      }),
      // Crédito a la anfitriona
      this.prisma.wallet.update({
        where: { userId: anfitrionaId },
        data: { balance: { increment: creditsRequired } },
      }),
      // Registro de ganancia de la anfitriona
      this.prisma.transaction.create({
        data: {
          walletId: anfitrionaWallet.id,
          type: 'EARNING',
          amount: creditsRequired,
          description: JSON.stringify({ service: 'Imagen Premium', clientUserId }),
        },
      }),
    ]);

    // 8. Registrar el unlock (garantiza idempotencia futura)
    await this.prisma.imageUnlock.create({
      data: {
        imageId,
        userId: clientUserId,
        creditsSpent: creditsRequired,
        transactionId: clientTx.id,
      },
    });

    return { alreadyUnlocked: false, creditsSpent: creditsRequired, imageUrl: image.url };
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

    // Use a transaction so the read-then-write is atomic and concurrent
    // requests cannot both create the same like (race condition).
    const liked = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.like.findUnique({
        where: { userId_anfitrionaId: { userId, anfitrionaId } },
      });

      if (existing) {
        await tx.like.delete({
          where: { userId_anfitrionaId: { userId, anfitrionaId } },
        });
        return false;
      } else {
        await tx.like.create({ data: { userId, anfitrionaId } });
        return true;
      }
    });

    const likesCount = await this.prisma.like.count({ where: { anfitrionaId } });
    return { liked, likesCount };
  }

  // ─── Galería permanente (HU: bloqueo de imágenes premium) ────────────────

  /**
   * Publica una imagen permanente en la galería de la anfitriona autenticada.
   * Sube el archivo a Cloudinary y crea el registro en AnfitrioneImage.
   */
  async publishGalleryImage(
    userId: string,
    dto: CreateGalleryImageDto,
    file: Express.Multer.File,
  ): Promise<GalleryImageDto> {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Perfil de anfitriona no encontrado.');
    }

    if (dto.isPremium && (!dto.unlockCredits || dto.unlockCredits <= 0)) {
      throw new BadRequestException(
        'Las imágenes premium requieren unlockCredits mayor a 0.',
      );
    }

    const upload = await this.cloudinary.uploadGalleryImage({ file, userId });

    const image = await this.prisma.anfitrioneImage.create({
      data: {
        profileId: profile.id,
        url: upload.secureUrl,
        publicId: upload.publicId,
        isPremium: dto.isPremium,
        unlockCredits: dto.isPremium ? dto.unlockCredits! : null,
        isVisible: true,
        sortOrder: 0,
      },
    });

    return {
      id: image.id,
      imageUrl: image.url,
      isPremium: image.isPremium,
      unlockCredits: image.unlockCredits,
      isVisible: image.isVisible,
      createdAt: image.createdAt.toISOString(),
    };
  }

  /**
   * Devuelve la galería completa de la anfitriona autenticada
   * (con toda la metadata de gestión).
   */
  async getMyGallery(userId: string): Promise<GalleryImageDto[]> {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            url: true,
            isPremium: true,
            unlockCredits: true,
            isVisible: true,
            createdAt: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Perfil de anfitriona no encontrado.');
    }

    return profile.images.map((img) => ({
      id: img.id,
      imageUrl: img.url,
      isPremium: img.isPremium,
      unlockCredits: img.unlockCredits,
      isVisible: img.isVisible,
      createdAt: img.createdAt.toISOString(),
    }));
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
