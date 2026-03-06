import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateClientStatusDto } from './dto/update-client-status.dto';
import { UserRole, Prisma } from "@prisma/client";


@Injectable()
export class ClientService {
    constructor(private prisma: PrismaService) { }

    // ACTUALIZAR EL ESTADO DE UN CLIENTE (ACTIVAR/DESACTIVAR)
    async updateStatus(id: string, updateClientStatusDto: UpdateClientStatusDto) {
        const user = await this.prisma.user.findFirst({
            where: { id, role: UserRole.USER }
        })

        if (!user) {
            throw new NotFoundException(`No se encontró un cliente con ID: ${id}`);
        }

        return this.prisma.user.update({
            where: { id },
            data: { isActive: updateClientStatusDto.isActive }
        });
    }

    // BUSCAR CLIENTE POR ID
    async findOne(id: string) {
        const client = await this.prisma.user.findFirst({
            where: {
                id,
                role: UserRole.USER,
            },
            include: {
                wallet: {
                    select: {
                        balance: true,
                    },
                },
            },
        });

        if (!client) {
            throw new NotFoundException(`No se encontró el cliente`);
        }

        const { password, ...clientData } = client;
        return clientData;
    }

    // LISTAR CLIENTES + BUSQUEDA
    async findAll(search?: string, page: number = 1, limit: number = 10) {

    const skip = (page - 1) * limit;

    const whereCondition: Prisma.UserWhereInput = {
        role: UserRole.USER,
        ...(search && {
            OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { phoneNumber: { contains: search } },
                { email: { contains: search, mode: 'insensitive' } },
            ]
        })
    };
    const [clients, total] = await Promise.all([
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

    const sanitizedClients = clients.map(({ password, ...clientData }) => clientData);
    return {
        data: sanitizedClients,
        meta: {
            total,
            page,
            lastPage: Math.ceil(total / limit),
            limit
        }
    };
}

}