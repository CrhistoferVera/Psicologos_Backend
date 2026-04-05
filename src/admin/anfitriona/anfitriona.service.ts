import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAnfitrionaDto, EditAnfitrionaDto } from './dto/update-anfitriona.dto';
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

    // LISTAR Anfitrionas + BUSQUEDA
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
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNumber: true,
                isActive: true,
                createdAt: true,
                wallet: { select: { balance: true } },
                anfitrionaProfile: {
                    select: {
                        username: true,
                        avatarUrl: true,
                        bio: true,
                        rateCredits: true,
                        isOnline: true,
                    }
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


        return {
            data: anfitriona,
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

    // EDITAR DATOS DE UNA ANFITRIONA
    async editAnfitriona(id: string, dto: EditAnfitrionaDto) {
        const user = await this.prisma.user.findFirst({
            where: { id, role: UserRole.ANFITRIONA }
        });

        if (!user) throw new NotFoundException(`No se encontró una anfitriona con ID: ${id}`);

        // Verificar unicidad de phoneNumber
        if (dto.phoneNumber) {
            const existing = await this.prisma.user.findFirst({
                where: { phoneNumber: dto.phoneNumber, NOT: { id } }
            });
            if (existing) throw new ConflictException('El número de teléfono ya está registrado.');
        }

        // Verificar unicidad de email
        if (dto.email) {
            const existing = await this.prisma.user.findFirst({
                where: { email: dto.email, NOT: { id } }
            });
            if (existing) throw new ConflictException('El email ya está registrado.');
        }

        // Verificar unicidad de username
        if (dto.username) {
            const existing = await this.prisma.anfitrioneProfile.findFirst({
                where: { username: dto.username, NOT: { userId: id } }
            });
            if (existing) throw new ConflictException('El nombre de usuario ya está en uso.');
        }

        // Actualizar User
        await this.prisma.user.update({
            where: { id },
            data: {
                ...(dto.phoneNumber && { phoneNumber: dto.phoneNumber }),
                ...(dto.email && { email: dto.email }),
            }
        });

        // Actualizar AnfitrioneProfile
        if (dto.username || dto.bio || dto.rateCredits) {
            await this.prisma.anfitrioneProfile.update({
                where: { userId: id },
                data: {
                    ...(dto.username && { username: dto.username }),
                    ...(dto.bio !== undefined && { bio: dto.bio }),
                    ...(dto.rateCredits && { rateCredits: dto.rateCredits }),
                }
            });
        }

        return this.findOne(id);
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