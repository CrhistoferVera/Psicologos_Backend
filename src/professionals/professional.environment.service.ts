import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CloudinaryService } from "../cloudinary/cloudinary.service";

@Injectable()
export class ProfessionalEnvironmentService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cloudinary: CloudinaryService
    ) { }

    // METODO PARA OBTENER AMBIENTES DE UN PROFESIONAL
    async getEnvironments(userId: string) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });
        if (!professional) throw new NotFoundException('Profesional no encontrado');

        return this.prisma.environments.findMany({
            where: { professionalId: professional.id },
        });
    }

    async getEnvironmentsByProfessionalId(userId: string) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });
        if (!professional) return [];
        return this.prisma.environments.findMany({
            where: { professionalId: professional.id },
        });
    }

    // METODO PARA AGREGAR AMBIENTES A UN PROFESIONAL
    async addEnvironment(userId: string, file: Express.Multer.File) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });
        if (!professional) throw new NotFoundException('Profesional no encontrado');

        const { secureUrl, publicId, resourceType } = await this.cloudinary.uploadEnvironmentMedia({ file, userId });

        return this.prisma.environments.create({
            data: {
                professionalId: professional.id,
                ImageUrl: secureUrl,
                Image_publicId: publicId,
                resourceType,
            },
        });
    }

    // METODO PARA ELIMINAR AMBIENTES DE UN PROFESIONAL
    async deleteEnvironment(userId: string, environmentId: string) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });
        if (!professional) throw new NotFoundException('Profesional no encontrado');

        const environment = await this.prisma.environments.findUnique({
            where: { id: environmentId },
        });
        if (!environment) throw new NotFoundException('Imagen no encontrada');
        if (environment.professionalId !== professional.id)
            throw new BadRequestException('No tienes permiso para eliminar esta imagen');

        await this.cloudinary.deleteHistoryMedia(environment.Image_publicId, environment.resourceType as 'image' | 'video');

        return this.prisma.environments.delete({ where: { id: environmentId } });
    }
}
