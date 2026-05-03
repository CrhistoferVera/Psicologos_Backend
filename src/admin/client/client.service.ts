import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateClientStatusDto } from './dto/update-client-status.dto';
import { UserRole, Prisma } from "@prisma/client";
import { BILLING_REGION_BOLIVIA, BILLING_REGION_INTERNATIONAL } from '../../common/phone-metadata.util';


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
    async findAll(search?: string, cursor?: string, limit: number = 10, billingRegion?: string) {
        const normalizedRegion = (billingRegion ?? '').trim().toUpperCase();
        const hasValidBillingRegion =
            normalizedRegion === BILLING_REGION_BOLIVIA || normalizedRegion === BILLING_REGION_INTERNATIONAL;

        const whereCondition: Prisma.UserWhereInput = {
            role: UserRole.USER,
            ...(hasValidBillingRegion ? { billingRegion: normalizedRegion } : {}),
            ...(search && {
                OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { phoneNumber: { contains: search } },
                    { email: { contains: search, mode: 'insensitive' } },
                ]
            })
        };

        const clients = await this.prisma.user.findMany({
            where: whereCondition,
            include: {
                wallet: {
                    select: { balance: true }
                }
            },
            orderBy: { id: 'desc' },
            take: limit + 1, // para saber si hay más datos
            ...(cursor && {
                skip: 1,
                cursor: { id: cursor }
            })
        });

        let nextCursor: string | null = null;

        if (clients.length > limit) {
            clients.pop(); // quitamos el extra
            nextCursor = clients[clients.length - 1].id; // último que enviamos
        }

        const sanitized = clients.map(({ password, ...data }) => data);

        return {
            data: sanitized,
            nextCursor
        };
    }


}
