import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAnfitrionaDto } from './dto/update-anfitriona.dto';
import { UserRole, Prisma, WithdrawalStatus } from "@prisma/client";


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
            orderBy: { id: 'desc' },
            take: limit + 1, // para saber si hay más datos
            ...(cursor && {
                skip: 1,
                cursor: { id: cursor }
            })
        });

        let nextCursor: string | null = null;

        if (anfitriona.length > limit) {
            anfitriona.pop(); // quitamos el extra
            nextCursor = anfitriona[anfitriona.length - 1].id; // último que enviamos
        }


        const sanitized = anfitriona.map(({ password, ...data }) => data);

        return {
            data: sanitized,
            nextCursor
        };
    }

    //LISTAR TODAS LAS SOLICTUDES DE PAGO QUE REALIZO LA ANFITRIONA + BUSQUEDA
    async findAllWithdrawalRequest(search?: string, cursor?: string, limit: number = 10) {
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
                            ]
                        }
                    }
                })
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
                                anfitrionaProfile: {
                                    select: {
                                        avatarUrl: true,
                                        coverUrl: true,
                                    }
                                }
                            }
                        }

                    }
                },
                bankAccount: { include: { bank: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            ...(cursor && { skip: 1, cursor: { id: cursor } })
        });

        let nextCursor: string | null = null;
        if (requests.length > limit) {
            requests.pop();
            nextCursor = requests[requests.length - 1].id;
        }

        return {
            data: requests.map(r => ({
                id: r.id,
                credits: Number(r.credits),
                soles: Number(r.soles),
                status: r.status,
                bankName: r.bankAccount.bank.name,
                accountNumber: r.bankAccount.accountNumber,
                anfitriona: r.wallet.user,

                currentBalance: Number(r.wallet.balance),

                createdAt: r.createdAt,
            })),
            nextCursor
        };
    }

    //CANTIDAD DE SOLICITUDES DE PAGOS PENDIENTES
    async countPendingRequests() {
        return await this.prisma.withdrawalRequest.count({
            where: { status: 'PENDING' }
        });
    }

    //HISTORIAL DE PAGOS A ANFITRIONA (RECHAZADO Y APROVADO)
    async findWithdrawalRequestHistory(search?: string, cursor?: string, limit: number = 10) {
        const requests = await this.prisma.withdrawalRequest.findMany({
            where: {
                status: {
                    in: [WithdrawalStatus.APPROVED, WithdrawalStatus.REJECTED]
                },
                ...(search && {
                    wallet: {
                        user: {
                            OR: [
                                { firstName: { contains: search, mode: 'insensitive' } },
                                { lastName: { contains: search, mode: 'insensitive' } },
                                { phoneNumber: { contains: search } },
                            ]
                        }
                    }
                })
            },
            include: {
                wallet: {
                    include: {
                        user: {
                            select: { id: true, firstName: true, lastName: true, phoneNumber: true }
                        }
                    }
                },
                bankAccount: { include: { bank: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            ...(cursor && { skip: 1, cursor: { id: cursor } })
        });

        let nextCursor: string | null = null;
        if (requests.length > limit) {
            requests.pop();
            nextCursor = requests[requests.length - 1].id;
        }

        return {
            data: requests.map(r => ({
                id: r.id,
                credits: Number(r.credits),
                soles: Number(r.soles),
                status: r.status,
                bankName: r.bankAccount.bank.name,
                accountNumber: r.bankAccount.accountNumber,
                anfitriona: r.wallet.user,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
            })),
            nextCursor
        };
    }

}