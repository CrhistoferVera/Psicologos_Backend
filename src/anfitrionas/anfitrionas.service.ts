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
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';
import { UpdateAnfitrioneProfileDto } from './dto/update-anfitriona-profile.dto';
import {
  ProfessionalPublicListItemDto,
  ProfessionalPublicListResponseDto,
} from './dto/professional-public-list.dto';
import { ProfessionalPublicDetailDto } from './dto/professional-public-detail.dto';
import { PROFESSIONAL_ROLE } from '../common/professional-role';

@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(dto: CreateAnfitrioneDto, idDocFile?: Express.Multer.File) {
    const [existingPhone, existingCedula, existingUsername, existingEmail] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } }),
        dto.cedula
          ? this.prisma.anfitrioneProfile.findFirst({ where: { cedula: dto.cedula } })
          : Promise.resolve(null),
        this.prisma.anfitrioneProfile.findUnique({ where: { username: dto.username } }),
        dto.email
          ? this.prisma.user.findUnique({ where: { email: dto.email } })
          : Promise.resolve(null),
      ]);

    if (existingPhone) throw new ConflictException('El numero de telefono ya esta registrado.');
    if (existingCedula) throw new ConflictException('La cedula ya esta registrada.');
    if (existingUsername) throw new ConflictException('El nombre de usuario ya esta en uso.');
    if (existingEmail) throw new ConflictException('El email ya esta registrado.');

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
          role: PROFESSIONAL_ROLE,
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
        const uploaded = await this.cloudinary.uploadAnfitrioneIdDoc({
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

    const profile = await this.prisma.anfitrioneProfile.create({
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
      where: { role: PROFESSIONAL_ROLE },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        firstName: true,
        lastName: true,
        isProfileComplete: true,
        isActive: true,
        createdAt: true,
        anfitrionaProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findFirst({
      where: { id, role: PROFESSIONAL_ROLE },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        firstName: true,
        lastName: true,
        isProfileComplete: true,
        isActive: true,
        createdAt: true,
        anfitrionaProfile: true,
      },
    });
  }

  async findAllPublic(
    page = 1,
    limit = 10,
    _currentUserId?: string,
    specialty?: string,
  ): Promise<ProfessionalPublicListResponseDto> {
    const specialtyFilter = this.buildSpecialtyFilter(specialty);

    const where: Prisma.UserWhereInput = {
      role: PROFESSIONAL_ROLE,
      isActive: true,
      isProfileComplete: true,
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
          anfitrionaProfile: {
            select: {
              username: true,
              avatarUrl: true,
              bio: true,
              rateCredits: true,
              isOnline: true,
              coverUrl: true,
            },
          },
          professionalSpecialties: {
            where: { specialty: { isActive: true } },
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
      this.prisma.user.count({ where }),
    ]);

    const data: ProfessionalPublicListItemDto[] = users.map((u) => {
      const profile = u.anfitrionaProfile;
      const mainImage = profile?.coverUrl ?? profile?.avatarUrl ?? null;

      return {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' '),
        username: profile?.username ?? null,
        avatar: profile?.avatarUrl ?? null,
        shortDescription: profile?.bio ?? null,
        rateCredits: profile?.rateCredits ?? null,
        mainImage,
        images: mainImage ? [mainImage] : [],
        isOnline: profile?.isOnline ?? false,
        specialties: u.professionalSpecialties.map((ps) => ps.specialty),
      };
    });

    return { data, total, page, limit };
  }

  async findOnePublic(id: string, _currentUserId?: string): Promise<ProfessionalPublicDetailDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: PROFESSIONAL_ROLE,
        isActive: true,
        isProfileComplete: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        anfitrionaProfile: {
          select: {
            username: true,
            dateOfBirth: true,
            avatarUrl: true,
            coverUrl: true,
            bio: true,
            rateCredits: true,
            isOnline: true,
          },
        },
        professionalSpecialties: {
          where: { specialty: { isActive: true } },
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
    });

    if (!user) throw new NotFoundException('Profesional no encontrado.');

    const profile = user.anfitrionaProfile;
    const age = profile?.dateOfBirth ? this.calculateAge(profile.dateOfBirth) : null;
    const coverImage = profile?.coverUrl ?? profile?.avatarUrl ?? null;

    return {
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      username: profile?.username ?? '',
      age,
      bio: profile?.bio ?? null,
      avatar: profile?.avatarUrl ?? null,
      coverImage,
      images: coverImage ? [coverImage] : [],
      rateCredits: profile?.rateCredits ?? null,
      isOnline: profile?.isOnline ?? false,
      specialties: user.professionalSpecialties.map((ps) => ps.specialty),
    };
  }

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
            coverUrl: true,
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
      coverUrl: user.anfitrionaProfile?.coverUrl ?? null,
    };
  }

  async updateMyProfile(
    userId: string,
    dto: UpdateAnfitrioneProfileDto,
    avatarFile?: Express.Multer.File,
    coverFile?: Express.Multer.File,
  ) {
    if (dto.username) {
      const conflict = await this.prisma.anfitrioneProfile.findFirst({
        where: { username: dto.username, NOT: { userId } },
      });
      if (conflict) throw new ConflictException('El nombre de usuario ya esta en uso.');
    }

    let avatarUpdate: { avatarUrl: string; avatarPublicId: string } | undefined;
    if (avatarFile) {
      const uploaded = await this.cloudinary.uploadAnfitrioneAvatar({ file: avatarFile, userId });
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

    const profileData: Prisma.AnfitrioneProfileUpdateInput = {
      ...(profileFields.username !== undefined && { username: profileFields.username }),
      ...(profileFields.bio !== undefined && { bio: profileFields.bio }),
      ...(profileFields.rateCredits !== undefined && { rateCredits: profileFields.rateCredits }),
      ...(profileFields.isOnline !== undefined && { isOnline: profileFields.isOnline }),
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

      const createData: Prisma.AnfitrioneProfileUncheckedCreateInput = {
        userId,
        username: usernameForCreate,
        dateOfBirth: null,
        cedula: null,
      };
      if (profileFields.bio !== undefined) createData.bio = profileFields.bio;
      if (profileFields.rateCredits !== undefined) createData.rateCredits = profileFields.rateCredits;
      if (profileFields.isOnline !== undefined) createData.isOnline = profileFields.isOnline;
      if (avatarUpdate) {
        createData.avatarUrl = avatarUpdate.avatarUrl;
        createData.avatarPublicId = avatarUpdate.avatarPublicId;
      }
      if (coverUpdate) {
        createData.coverUrl = coverUpdate.coverUrl;
        createData.coverPublicId = coverUpdate.coverPublicId;
      }

      await this.prisma.anfitrioneProfile.upsert({
        where: { userId },
        update: profileData,
        create: createData,
      });
    }

    return this.getMyProfile(userId);
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
