import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAnfitrionaDto } from './dto/update-anfitriona.dto';
import { UserRole, Prisma } from "@prisma/client";


@Injectable()
export class AnfitrionaService {
    constructor(private prisma: PrismaService) { }

    // ACTUALIZAR EL ESTADO DE UN CLIENTE (ACTIVAR/DESACTIVAR)
    async updateStatus(id: string, updateAnfitrionaDto: UpdateAnfitrionaDto) {
        const user = await this.prisma.user.findFirst({
            where: { id, role: UserRole.ANFITRIONA }
        })

        if (!user) {
            throw new NotFoundException(`No se encontró una anfitriona con ID: ${id}`);
        }

        return this.prisma.user.update({
            where: { id },
            data: { isActive: updateAnfitrionaDto.isActive }
        });
    }

    // BUSCAR CLIENTE POR ID
    async findOne(id: string) {
        const anfitriona = await this.prisma.user.findFirst({
            where: {
                id,
                role: UserRole.ANFITRIONA,
            },
            include: {
                wallet: {
                    select: {
                        balance: true,
                    },
                },
            },
        });

        if (!anfitriona) {
            throw new NotFoundException(`No se encontró a la anfitriona`);
        }

        const { password, ...anfitrionaData } = anfitriona;
        return anfitrionaData;
    }

    // LISTAR CLIENTES + BUSQUEDA
    async findAll(search?: string, page: number = 1, limit: number = 10) {

        const skip = (page - 1) * limit;

        const whereCondition: Prisma.UserWhereInput = {
            role: UserRole.ANFITRIONA,
            ...(search && {
                OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { phoneNumber: { contains: search } },
                    { email: { contains: search, mode: 'insensitive' } },
                ]
            })
        };
        const [anfitriona, total] = await Promise.all([
            this.prisma.user.findMany({
                where: whereCondition,
                include: {
                    wallet: {
                        select: { balance: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip: skip,
                take: limit
            }),

            this.prisma.user.count({
                where: whereCondition
            })
        ]);

        const sanitizedAnfitriona = anfitriona.map(({ password, ...anfitrionaData }) => anfitrionaData);
        return {
            data: sanitizedAnfitriona,
            meta: {
                total,
                page,
                lastPage: Math.ceil(total / limit),
                limit
            }
        };
    }

}