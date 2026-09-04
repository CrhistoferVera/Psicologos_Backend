import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CloudinaryService } from "../cloudinary/cloudinary.service";
import { CreateAcademyBackgroundDto } from "./dto/createAcademyBackground-professional.dto";
import { UpdateAcademyBackgroundDto } from "./dto/updateAcademyBackground-professional.dto";

@Injectable()
export class ProfessionalPerfilService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cloudinary: CloudinaryService
    ) { }

    // METODO PARA AGREGAR ANTECEDENTES ACADEMICOS A UN PROFESIONAL
    async addAcademicBackground(userId: string, dto: CreateAcademyBackgroundDto) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });

        if (!professional) throw new NotFoundException('Profesional no encontrado');

        const professionalId = professional.id;

        const [limitCountActual, config] = await Promise.all([
            this.prisma.academyBackground.count({ where: { professionalId } }),
            this.prisma.systemConfig.findUnique({
                where: { id: 'global' },
                select: { limitAddAcademyBackgrounds: true },
            }),
        ]);

        if (config && limitCountActual >= config.limitAddAcademyBackgrounds) {
            throw new BadRequestException('Se alcanzó el límite de antecedentes académicos');
        }

        return this.prisma.academyBackground.create({
            data: { professionalId, ...dto },
        });
    }

    // METODO PARA ELIMINAR ANTECEDENTES ACADEMICOS DE UN PROFESIONAL
    async deleteAcademicBackground(userId: string, backgroundId: string) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });

        if (!professional) throw new NotFoundException('Profesional no encontrado');

        const professionalId = professional.id;

        return this.prisma.academyBackground.delete({
            where: { id: backgroundId, professionalId },
        });
    }

    // METODO PARA OBTENER ANTECEDENTES ACADEMICOS DE UN PROFESIONAL
    async getAcademyBackgrounds(userId: string) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });

        if (!professional) throw new NotFoundException('Profesional no encontrado');

        const professionalId = professional.id;

        return this.prisma.academyBackground.findMany({
            where: { professionalId },
        });
    }

    // METODO PARA ACTUALIZAR ANTECEDENTES ACADEMICOS DE UN PROFESIONAL
    async updateAcademyBackground(userId: string, backgroundId: string, dto: UpdateAcademyBackgroundDto) {
        const professional = await this.prisma.professionalProfile.findUnique({
            where: { userId },
        });

        if (!professional) throw new NotFoundException('Profesional no encontrado');

        const professionalId = professional.id;

        return this.prisma.academyBackground.update({
            where: { id: backgroundId, professionalId },
            data: dto,
        });
    }
}