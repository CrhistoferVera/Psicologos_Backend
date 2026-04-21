import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, WithdrawalStatus, ProfessionalReviewStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateProfessionalDto, EditProfessionalDto } from './dto/update-professional.dto';
import { UpdateProfessionalProfileDto } from './dto/update-professional-profile.dto';
import { PROFESSIONAL_ROLES } from '../../common/professional-role';

@Injectable()
export class AdminProfessionalsService {
  constructor(private prisma: PrismaService) {}

  async updateStatus(id: string, updateStatusDto: UpdateProfessionalDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: { in: PROFESSIONAL_ROLES } },
      select: {
        id: true,
        professionalProfile: {
          select: {
            username: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`No se encontro un profesional con ID: ${id}`);
    }

    const reviewStatus =
      updateStatusDto.reviewStatus ??
      (updateStatusDto.isActive ? ProfessionalReviewStatus.APPROVED : ProfessionalReviewStatus.REJECTED);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive: updateStatusDto.isActive },
      }),
      this.prisma.professionalProfile.upsert({
        where: { userId: id },
        update: {
          reviewStatus,
          ...(updateStatusDto.reviewNotes !== undefined
            ? { reviewNotes: updateStatusDto.reviewNotes }
            : {}),
        },
        create: {
          userId: id,
          username: user.professionalProfile?.username ?? `prof_${id.slice(0, 8)}`,
          reviewStatus,
          ...(updateStatusDto.reviewNotes !== undefined
            ? { reviewNotes: updateStatusDto.reviewNotes }
            : {}),
        },
      }),
    ]);

    return this.findOne(id);
  }

  async updateProfile(id: string, dto: UpdateProfessionalProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: { in: PROFESSIONAL_ROLES } },
    });
    if (!user) throw new NotFoundException('Profesional no encontrado');

    const [updatedUser, updatedProfile] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        },
      }),
      this.prisma.professionalProfile.upsert({
        where: { userId: id },
        update: {
          ...(dto.username !== undefined && { username: dto.username }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
        },
        create: {
          userId: id,
          username: dto.username ?? `prof_${id.slice(0, 8)}`,
          ...(dto.bio !== undefined && { bio: dto.bio }),
        },
      }),
    ]);

    const { password, ...userData } = updatedUser as any;
    return { ...userData, profile: updatedProfile };
  }

  async findOne(id: string) {
    const professional = await this.prisma.user.findFirst({
      where: {
        id,
        role: { in: PROFESSIONAL_ROLES },
      },
      include: {
        wallet: {
          select: {
            balance: true,
            promotionalBalance: true,
          },
        },
        professionalProfile: {
          select: {
            username: true,
            avatarUrl: true,
            bio: true,
            rateCredits: true,
            isOnline: true,
            idDocUrl: true,
            reviewStatus: true,
            reviewNotes: true,
            availability: true,
            kycVideoUrl: true,
            kycSelfieUrl: true,
            matriculaUrl: true,
            tituloProfesionalUrl: true,
            kycFaceMatchScore: true,
            kycFaceMatchStatus: true,
          },
        },
      },
    });

    if (!professional) {
      throw new NotFoundException('No se encontro el profesional');
    }

    const { password, ...professionalData } = professional;
    return professionalData;
  }

  async findAll(search?: string, cursor?: string, limit = 10) {
    const whereCondition: Prisma.UserWhereInput = {
      role: { in: PROFESSIONAL_ROLES },
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const professionals = await this.prisma.user.findMany({
      where: whereCondition,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        isActive: true,
        createdAt: true,
        wallet: { select: { balance: true, promotionalBalance: true } },
        professionalProfile: {
          select: {
            username: true,
            avatarUrl: true,
            bio: true,
            rateCredits: true,
            isOnline: true,
            idDocUrl: true,
            reviewStatus: true,
            reviewNotes: true,
            kycVideoUrl: true,
            kycSelfieUrl: true,
            matriculaUrl: true,
            tituloProfesionalUrl: true,
            kycFaceMatchScore: true,
            kycFaceMatchStatus: true,
          },
        },
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
    });

    let nextCursor: string | null = null;
    if (professionals.length > limit) {
      professionals.pop();
      nextCursor = professionals[professionals.length - 1].id;
    }

    return {
      data: professionals,
      nextCursor,
    };
  }

  async findAllWithdrawalRequest(search?: string, cursor?: string, limit = 10) {
    const requests = await this.prisma.withdrawalRequest.findMany({
      where: {
        status: WithdrawalStatus.PENDING,
        ...(search && {
          wallet: {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { phoneNumber: { contains: search } },
              ],
            },
          },
        }),
      },
      include: {
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phoneNumber: true,
                email: true,
                professionalProfile: {
                  select: {
                    avatarUrl: true,
                    coverUrl: true,
                  },
                },
              },
            },
          },
        },
        bankAccount: { include: { bank: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });

    let nextCursor: string | null = null;
    if (requests.length > limit) {
      requests.pop();
      nextCursor = requests[requests.length - 1].id;
    }

    return {
      data: requests.map((r) => ({
        id: r.id,
        credits: Number(r.credits),
        soles: Number(r.soles),
        status: r.status,
        notes: r.notes,
        rejectionReason: r.rejectionReason,
        bankName: r.bankAccount.bank.name,
        accountNumber: r.bankAccount.accountNumber,
        professional: r.wallet.user,
        currentBalance: Number(r.wallet.balance),
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }

  async editProfessional(id: string, dto: EditProfessionalDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: { in: PROFESSIONAL_ROLES } },
    });

    if (!user) throw new NotFoundException(`No se encontro un profesional con ID: ${id}`);

    if (dto.phoneNumber) {
      const existing = await this.prisma.user.findFirst({
        where: { phoneNumber: dto.phoneNumber, NOT: { id } },
      });
      if (existing) throw new ConflictException('El numero de telefono ya esta registrado.');
    }

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (existing) throw new ConflictException('El email ya esta registrado.');
    }

    if (dto.username) {
      const existing = await this.prisma.professionalProfile.findFirst({
        where: { username: dto.username, NOT: { userId: id } },
      });
      if (existing) throw new ConflictException('El nombre de usuario ya esta en uso.');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.phoneNumber && { phoneNumber: dto.phoneNumber }),
        ...(dto.email && { email: dto.email }),
      },
    });

    if (dto.username || dto.bio || dto.rateCredits) {
      await this.prisma.professionalProfile.update({
        where: { userId: id },
        data: {
          ...(dto.username && { username: dto.username }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
          ...(dto.rateCredits && { rateCredits: dto.rateCredits }),
        },
      });
    }

    return this.findOne(id);
  }

  async countPendingRequests() {
    return this.prisma.withdrawalRequest.count({
      where: { status: WithdrawalStatus.PENDING },
    });
  }

  async findWithdrawalRequestHistory(search?: string, cursor?: string, limit = 10) {
    const requests = await this.prisma.withdrawalRequest.findMany({
      where: {
        status: {
          in: [WithdrawalStatus.APPROVED, WithdrawalStatus.REJECTED],
        },
        ...(search && {
          wallet: {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { phoneNumber: { contains: search } },
              ],
            },
          },
        }),
      },
      include: {
        wallet: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, phoneNumber: true },
            },
          },
        },
        bankAccount: { include: { bank: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });

    let nextCursor: string | null = null;
    if (requests.length > limit) {
      requests.pop();
      nextCursor = requests[requests.length - 1].id;
    }

    return {
      data: requests.map((r) => ({
        id: r.id,
        credits: Number(r.credits),
        soles: Number(r.soles),
        status: r.status,
        notes: r.notes,
        rejectionReason: r.rejectionReason,
        receiptUrl: r.receiptUrl,
        receiptPublicId: r.receiptPublicId,
        bankName: r.bankAccount.bank.name,
        accountNumber: r.bankAccount.accountNumber,
        professional: r.wallet.user,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      nextCursor,
    };
  }
}

