import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';

@Injectable()
export class AnfitrioneService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  async create(dto: CreateAnfitrioneDto, idDocFile?: Express.Multer.File) {
    // Verificar unicidad antes de crear
    const [existingPhone, existingCedula, existingUsername, existingEmail] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } }),
        this.prisma.anfitrionaProfile.findUnique({ where: { cedula: dto.cedula } }),
        this.prisma.anfitrionaProfile.findUnique({ where: { username: dto.username } }),
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
        },
      });
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
    const profile = await this.prisma.anfitrionaProfile.create({
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
}
