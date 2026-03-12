import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';
import { CreateHistoryDto } from './dto/create-history.dto';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class AnfitrioneService {
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
        id:true,
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

}
