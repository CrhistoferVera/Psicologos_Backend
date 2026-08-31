import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateProfessionalDto } from './dto/create-professional.dto';
import { UpdateProfessionalProfileDto } from './dto/update-professional-profile.dto';
import {
  ProfessionalPublicListItemDto,
  ProfessionalPublicListResponseDto,
} from './dto/professional-public-list.dto';
import { ProfessionalPublicDetailDto } from './dto/professional-public-detail.dto';
import { PROFESSIONAL_ROLE, PROFESSIONAL_ROLES } from '../common/professional-role';
import { createUniqueReferralCode } from '../referrals/utils/referral-code.util';

@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(dto: CreateProfessionalDto, idDocFile?: Express.Multer.File) {
    const [existingPhone, existingCedula, existingUsername, existingEmail] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } }),
        dto.cedula
          ? this.prisma.professionalProfile.findFirst({ where: { cedula: dto.cedula } })
          : Promise.resolve(null),
        this.prisma.professionalProfile.findUnique({ where: { username: dto.username } }),
        dto.email
          ? this.prisma.user.findUnique({ where: { email: dto.email } })
          : Promise.resolve(null),
      ]);

    if (existingPhone) throw new ConflictException('El numero de telefono ya esta registrado.');
    if (existingCedula) throw new ConflictException('La cedula ya esta registrada.');
    if (existingUsername) throw new ConflictException('El nombre de usuario ya esta en uso.');
    if (existingEmail) throw new ConflictException('El email ya esta registrado.');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const referralCode = await createUniqueReferralCode(this.prisma, dto.firstName ?? dto.username);

    let user: Awaited<ReturnType<typeof this.prisma.user.create>>;
    try {
      user = await this.prisma.user.create({
        data: {
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          password: hashedPassword,
          role: PROFESSIONAL_ROLE,
          referralCode,
          isProfileComplete: true,
          wallet: {
            create: {
              balance: 0,
              promotionalBalance: 0,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un usuario con esos datos.');
      }
      throw new InternalServerErrorException('Error al crear la profesional.');
    }

    let idDocUrl: string | null = null;
    let idDocPublicId: string | null = null;

    if (idDocFile) {
      try {
        const uploaded = await this.cloudinary.uploadProfessionalIdDoc({
          file: idDocFile,
          userId: user.id,
        });
        idDocUrl = uploaded.secureUrl;
        idDocPublicId = uploaded.publicId;
      } catch {
        await this.prisma.user.delete({ where: { id: user.id } });
        throw new InternalServerErrorException('Error al subir el documento de identidad.');
      }
    }

    const profile = await this.prisma.professionalProfile.create({
      data: {
        userId: user.id,
        username: dto.username,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        cedula: dto.cedula ?? null,
        idDocUrl,
        idDocPublicId,
      },
    });

    const { password, resetPasswordExpiry, resetPasswordToken, ...safeUser } = user;
    return { user: safeUser, profile };
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { role: { in: PROFESSIONAL_ROLES } },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        firstName: true,
        lastName: true,
        isProfileComplete: true,
        isActive: true,
        createdAt: true,
        professionalProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findFirst({
      where: { id, role: { in: PROFESSIONAL_ROLES } },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        firstName: true,
        lastName: true,
        isProfileComplete: true,
        isActive: true,
        createdAt: true,
        professionalProfile: true,
      },
    });
  }

  async findAllPublic(
    page = 1,
    limit = 10,
    currentUserId?: string,
    specialty?: string,
    search?: string,
  ): Promise<ProfessionalPublicListResponseDto> {
    const specialtyFilter = this.buildSpecialtyFilter(specialty);
    const searchTerm = search?.trim() ?? '';

    let countryFilter: string | null = null;
    if (currentUserId) {
      const viewer = await this.prisma.user.findUnique({
        where: { id: currentUserId },
        select: { country: true },
      });
      countryFilter = viewer?.country ?? null;
    }

    const where: Prisma.UserWhereInput = {
      role: { in: PROFESSIONAL_ROLES },
      isActive: true,
      isProfileComplete: true,
      professionalProfile: {
        is: { reviewStatus: 'APPROVED' },
      },
      wallet: {
        is: { isBlocked: false },
      },
      ...(countryFilter ? { country: countryFilter } : {}),
      ...(specialtyFilter
        ? {
            professionalSpecialties: {
              some: {
                specialty: {
                  isActive: true,
                  ...specialtyFilter,
                },
              },
            },
          }
        : {}),
      ...(searchTerm
        ? {
            OR: [
              { firstName: { contains: searchTerm, mode: Prisma.QueryMode.insensitive } },
              { lastName: { contains: searchTerm, mode: Prisma.QueryMode.insensitive } },
              {
                professionalProfile: {
                  is: { username: { contains: searchTerm, mode: Prisma.QueryMode.insensitive } },
                },
              },
              {
                professionalSpecialties: {
                  some: {
                    specialty: {
                      isActive: true,
                      name: { contains: searchTerm, mode: Prisma.QueryMode.insensitive },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [
          { professionalProfile: { isOnline: 'desc' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          userProfile: {
            select: {
              bio: true,
            },
          },
          professionalProfile: {
            select: {
              username: true,
              title: true,
              avatarUrl: true,
              bio: true,
              isOnline: true,
              coverUrl: true,
              languages: true,
              servicePrices: {
                select: {
                  serviceType: true,
                  price: true,
                },
              },
            },
          },
          professionalSpecialties: {
            where: { specialty: { isActive: true } },
            orderBy: { sortOrder: 'asc' },
            select: {
              specialty: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
          professionalSessionOfferings: {
            where: { isActive: true },
            select: {
              priceBob: true,
              priceUsd: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data: ProfessionalPublicListItemDto[] = users.map((u) => {
      const profile = u.professionalProfile;
      const mainImage = profile?.coverUrl ?? profile?.avatarUrl ?? null;

      // Precio de la sesion mas barata; se calcula por moneda porque la oferta
      // mas barata en Bs no tiene por que ser la mas barata en USD.
      const offerings = u.professionalSessionOfferings ?? [];
      const lowestSessionPriceBob = offerings.length
        ? Math.min(...offerings.map((o) => Number(o.priceBob)))
        : null;
      const lowestSessionPriceUsd = offerings.length
        ? Math.min(...offerings.map((o) => Number(o.priceUsd)))
        : null;

      return {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' '),
        username: profile?.username ?? null,
        title: profile?.title ?? null,
        avatar: profile?.avatarUrl ?? null,
        shortDescription: profile?.bio ?? u.userProfile?.bio ?? null,
        mainImage,
        images: mainImage ? [mainImage] : [],
        isOnline: profile?.isOnline ?? false,
        specialties: u.professionalSpecialties.map((ps) => ps.specialty),
        languages: profile?.languages ?? [],
        servicePrices: (profile?.servicePrices ?? []).map((sp) => ({
          serviceType: String(sp.serviceType),
          price: Number(sp.price),
        })),
        lowestSessionPriceBob,
        lowestSessionPriceUsd,
      };
    });

    return { data, total, page, limit };
  }

  async findOnePublic(id: string, _currentUserId?: string): Promise<ProfessionalPublicDetailDto> {
    const [user, reviewStats] = await Promise.all([
    this.prisma.user.findFirst({
      where: {
        id,
        role: { in: PROFESSIONAL_ROLES },
        isActive: true,
        isProfileComplete: true,
        wallet: { is: { isBlocked: false } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        userProfile: {
          select: {
            bio: true,
          },
        },
        professionalProfile: {
          select: {
            username: true,
            title: true,
            dateOfBirth: true,
            avatarUrl: true,
            coverUrl: true,
            bio: true,
            isOnline: true,
            education: true,
            languages: true,
            reviewStatus: true,
          },
        },
        professionalSpecialties: {
          where: { specialty: { isActive: true } },
          orderBy: { sortOrder: 'asc' },
          select: {
            specialty: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    }),
    this.prisma.bookingReview.aggregate({
      where: { professionalId: id },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    ]);

    if (!user) throw new NotFoundException('Profesional no encontrado.');

    const profile = user.professionalProfile;
    const age = profile?.dateOfBirth ? this.calculateAge(profile.dateOfBirth) : null;
    const coverImage = profile?.coverUrl ?? profile?.avatarUrl ?? null;

    return {
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      username: profile?.username ?? '',
      title: profile?.title ?? null,
      age,
      bio: profile?.bio ?? user.userProfile?.bio ?? null,
      avatar: profile?.avatarUrl ?? null,
      coverImage,
      images: coverImage ? [coverImage] : [],
      isOnline: profile?.isOnline ?? false,
      specialties: user.professionalSpecialties.map((ps) => ps.specialty),
      rating: reviewStats._avg.rating ?? null,
      reviewCount: reviewStats._count.rating,
      education: (profile?.education ?? []) as Record<string, unknown>[],
      languages: profile?.languages ?? [],
      isVerified: profile?.reviewStatus === 'APPROVED',
    };
  }

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isActive: true,
        professionalProfile: {
          select: {
            username: true,
            title: true,
            bio: true,
            education: true,
            isOnline: true,
            avatarUrl: true,
            coverUrl: true,
            reviewStatus: true,
            reviewNotes: true,
            availability: true,
            languages: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.professionalProfile?.username ?? '',
      title: user.professionalProfile?.title ?? null,
      bio: user.professionalProfile?.bio ?? '',
      isOnline: user.professionalProfile?.isOnline ?? false,
      avatarUrl: user.professionalProfile?.avatarUrl ?? null,
      coverUrl: user.professionalProfile?.coverUrl ?? null,
      reviewStatus: user.professionalProfile?.reviewStatus ?? 'PENDING',
      reviewNotes: user.professionalProfile?.reviewNotes ?? null,
      availability:
        (user.professionalProfile?.availability as Record<string, unknown> | null) ?? null,
      education: (user.professionalProfile?.education ?? []) as Record<string, unknown>[],
      languages: user.professionalProfile?.languages ?? [],
      isActive: user.isActive,
    };
  }

  async getMyReviewStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        professionalProfile: {
          select: {
            reviewStatus: true,
            reviewNotes: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado.');

    return {
      status: user.professionalProfile?.reviewStatus ?? 'PENDING',
      notes: user.professionalProfile?.reviewNotes ?? null,
      isActive: user.isActive,
      updatedAt: user.professionalProfile?.updatedAt ?? null,
    };
  }

  async updateMyProfile(
    userId: string,
    dto: UpdateProfessionalProfileDto,
    avatarFile?: Express.Multer.File,
    coverFile?: Express.Multer.File,
  ) {
    if (dto.username) {
      const conflict = await this.prisma.professionalProfile.findFirst({
        where: { username: dto.username, NOT: { userId } },
      });
      if (conflict) throw new ConflictException('El nombre de usuario ya esta en uso.');
    }

    let avatarUpdate: { avatarUrl: string; avatarPublicId: string } | undefined;
    if (avatarFile) {
      const uploaded = await this.cloudinary.uploadProfessionalAvatar({ file: avatarFile, userId });
      avatarUpdate = { avatarUrl: uploaded.secureUrl, avatarPublicId: uploaded.publicId };
    }

    let coverUpdate: { coverUrl: string; coverPublicId: string } | undefined;
    if (coverFile) {
      const uploaded = await this.cloudinary.uploadCoverImage({ file: coverFile, userId });
      coverUpdate = { coverUrl: uploaded.secureUrl, coverPublicId: uploaded.publicId };
    }

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

    const profileData: Prisma.ProfessionalProfileUpdateInput = {
      ...(profileFields.username !== undefined && { username: profileFields.username }),
      ...(profileFields.title !== undefined && {
        title: profileFields.title === '' ? null : profileFields.title,
      }),
      ...(profileFields.bio !== undefined && { bio: profileFields.bio }),
      ...(profileFields.isOnline !== undefined && { isOnline: profileFields.isOnline }),
      ...(profileFields.availability !== undefined && {
        availability: profileFields.availability as Prisma.InputJsonValue,
      }),
      ...(profileFields.education !== undefined && {
        education: profileFields.education as unknown as Prisma.InputJsonValue,
      }),
      ...(profileFields.languages !== undefined && { languages: profileFields.languages }),
      ...(avatarUpdate && {
        avatarUrl: avatarUpdate.avatarUrl,
        avatarPublicId: avatarUpdate.avatarPublicId,
      }),
      ...(coverUpdate && {
        coverUrl: coverUpdate.coverUrl,
        coverPublicId: coverUpdate.coverPublicId,
      }),
    };

    if (Object.keys(profileData).length > 0) {
      const usernameForCreate =
        (profileData.username as string | undefined) ?? `prof_${userId.slice(0, 8)}`;

      const createData: Prisma.ProfessionalProfileUncheckedCreateInput = {
        userId,
        username: usernameForCreate,
        dateOfBirth: null,
        cedula: null,
      };
      if (profileFields.title !== undefined && profileFields.title !== '') {
        createData.title = profileFields.title;
      }
      if (profileFields.bio !== undefined) createData.bio = profileFields.bio;
      if (profileFields.isOnline !== undefined) createData.isOnline = profileFields.isOnline;
      if (profileFields.availability !== undefined) {
        createData.availability = profileFields.availability as Prisma.InputJsonValue;
      }
      if (avatarUpdate) {
        createData.avatarUrl = avatarUpdate.avatarUrl;
        createData.avatarPublicId = avatarUpdate.avatarPublicId;
      }
      if (coverUpdate) {
        createData.coverUrl = coverUpdate.coverUrl;
        createData.coverPublicId = coverUpdate.coverPublicId;
      }

      await this.prisma.professionalProfile.upsert({
        where: { userId },
        update: profileData,
        create: createData,
      });
    }

    return this.getMyProfile(userId);
  }

  async uploadEducationPhoto(userId: string, file: Express.Multer.File): Promise<{ url: string }> {
    const { secureUrl } = await this.cloudinary.uploadEducationPhoto({ file, userId });
    return { url: secureUrl };
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

  private buildSpecialtyFilter(specialty?: string): Prisma.SpecialtyWhereInput | null {
    const value = specialty?.trim();
    if (!value) return null;

    return {
      OR: [
        { id: value },
        { slug: { equals: value.toLowerCase(), mode: 'insensitive' } },
        { name: { contains: value, mode: 'insensitive' } },
      ],
    };
  }
}


