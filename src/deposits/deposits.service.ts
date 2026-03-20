import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; // Ajusta la ruta a tu PrismaService
import { CreateDepositRequestDto } from './dto/create-depositRequest.dto';
import { DepositStatus, UserRole } from '@prisma/client';

@Injectable()
export class DepositsService {
    constructor(private prisma: PrismaService) { }

    //SERVICIO PARA CREAR UN DEPÓSITO POR LA COMPRA DE UN PAQUETE
    async createDepositRequest(
        userId: string,
        createDepositDto: CreateDepositRequestDto,
        receiptData: { url: string; publicId: string }
    ) {

        //validar que el paquete exista y este activo
        const pkg = await this.prisma.package.findUnique({
            where: { id: createDepositDto.packageId, isActive: true } //Ese packageId viene del body de la request
        });

        if (!pkg || !pkg.isActive) {
            throw new NotFoundException('El paquete no existe o no está activo.');
        }

        //validar que el metodo de pago exista y este activo
        const paymentMethod = await this.prisma.paymentMethod.findUnique({
            where: {
                id: createDepositDto.paymentMethodId,
                isActive: true
            }
        });

        if (!paymentMethod || !paymentMethod.isActive) {
            throw new NotFoundException('El método de pago no existe o no está activo.');
        }

        //validar que el usuario con rol cliente este activo
        const user = await this.prisma.user.findFirst({
            where: { id: userId, role: UserRole.USER, isActive: true }
        });

        if (!user || !user.isActive) {
            throw new NotFoundException('El usuario no existe o no está activo.');
        }

        //crear la solicitud de depósito en estado PENDING y usando el precio del paquete (pkg.price)
        return await this.prisma.depositRequest.create({
            data: {
                userId,
                packageId: createDepositDto.packageId,
                paymentMethodId: createDepositDto.paymentMethodId,
                amount: pkg.price,
                status: DepositStatus.PENDING,
                receiptUrl: receiptData.url,
                receiptPublicId: receiptData.publicId,
            },
            include: {
                package: true,
                paymentMethod: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        phoneNumber: true,
                    }
                }
            }
        });

    }
}
