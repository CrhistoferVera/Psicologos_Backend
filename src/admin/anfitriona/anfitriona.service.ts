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
    async findAll(search?: string, cursor?: string, limit: number = 10) {

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

        const anfitriona = await this.prisma.user.findMany({
            where: whereCondition,
            include: {
                wallet: {
                    select: { balance: true }
                }
            },
            orderBy: [
                { isActive: 'desc' },
                { createdAt: 'desc' }
            ],
            take: limit + 1, // para saber si hay más datos
            ...(cursor && {
                skip: 1,
                cursor: { id: cursor }
            })
        });

        let nextCursor: string | null = null;

        if (anfitriona.length > limit) {
            const nextItem = anfitriona.pop();
            nextCursor = nextItem!.id;
        }

        const sanitized = anfitriona.map(({ password, ...data }) => data);

        return {
            data: sanitized,
            nextCursor
        };
    }

   
}