import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSpecialtyDto } from './dto/create-specialty.dto';
import { UpdateSpecialtyDto } from './dto/update-specialty.dto';
import { AssignProfessionalSpecialtiesDto } from './dto/assign-professional-specialties.dto';
import { PROFESSIONAL_ROLE } from '../../common/professional-role';

@Injectable()
export class SpecialtyService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private async ensureUniqueSlug(baseValue: string, excludeId?: string): Promise<string> {
    const baseSlug = this.slugify(baseValue) || 'especialidad';
    let slug = baseSlug;
    let suffix = 1;

    while (true) {
      const exists = await this.prisma.specialty.findFirst({
        where: {
          slug,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      });

      if (!exists) return slug;
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
  }

  async create(dto: CreateSpecialtyDto) {
    const normalizedName = dto.name.trim();

    const existingName = await this.prisma.specialty.findFirst({
      where: { name: { equals: normalizedName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingName) {
      throw new ConflictException('Ya existe una especialidad con ese nombre.');
    }

    const slug = await this.ensureUniqueSlug(normalizedName);

    return this.prisma.specialty.create({
      data: {
        name: normalizedName,
        slug,
        description: dto.description?.trim() || null,
      },
    });
  }

  async findAll(includeInactive = false, search?: string) {
    return this.prisma.specialty.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async update(id: string, dto: UpdateSpecialtyDto) {
    const current = await this.prisma.specialty.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Especialidad no encontrada.');
    }

    const nextName = dto.name?.trim();

    if (nextName && nextName.toLowerCase() !== current.name.toLowerCase()) {
      const nameExists = await this.prisma.specialty.findFirst({
        where: {
          name: { equals: nextName, mode: 'insensitive' },
          NOT: { id },
        },
        select: { id: true },
      });
      if (nameExists) {
        throw new ConflictException('Ya existe una especialidad con ese nombre.');
      }
    }

    return this.prisma.specialty.update({
      where: { id },
      data: {
        ...(nextName ? { name: nextName, slug: await this.ensureUniqueSlug(nextName, id) } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deactivate(id: string) {
    const current = await this.prisma.specialty.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Especialidad no encontrada.');
    }

    return this.prisma.specialty.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async assignToProfessional(userId: string, dto: AssignProfessionalSpecialtiesDto) {
    const professional = await this.prisma.user.findFirst({
      where: { id: userId, role: PROFESSIONAL_ROLE },
      select: { id: true },
    });
    if (!professional) {
      throw new NotFoundException('Profesional no encontrado.');
    }

    const specialtyIds = Array.from(new Set(dto.specialtyIds));

    if (specialtyIds.length > 0) {
      const found = await this.prisma.specialty.findMany({
        where: { id: { in: specialtyIds }, isActive: true },
        select: { id: true },
      });

      if (found.length !== specialtyIds.length) {
        throw new BadRequestException('Una o mas especialidades no existen o estan inactivas.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.professionalSpecialty.deleteMany({ where: { professionalId: userId } });

      if (specialtyIds.length > 0) {
        await tx.professionalSpecialty.createMany({
          data: specialtyIds.map((specialtyId) => ({
            professionalId: userId,
            specialtyId,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.getProfessionalSpecialties(userId);
  }

  async getProfessionalSpecialties(userId: string) {
    return this.prisma.professionalSpecialty.findMany({
      where: { professionalId: userId },
      include: {
        specialty: {
          select: { id: true, name: true, slug: true, description: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
