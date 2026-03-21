import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; // Ajusta la ruta a tu PrismaService
import { CreateDepositRequestDto } from './dto/create-depositRequest.dto';
import { DepositStatus, UserRole } from '@prisma/client';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@Injectable()
export class DepositsService {
    constructor(
        private cloudinaryService: CloudinaryService,
        private prisma: PrismaService) { }

    //SERVICIO PARA CREAR UN DEPÓSITO POR LA COMPRA DE UN PAQUETE
    async createDepositRequest(
        userId: string,
        createDepositDto: CreateDepositRequestDto,
        file: Express.Multer.File,
    ) {

        //validar que el paquete exista y este activo
        const pkg = await this.prisma.package.findFirst({
            where: {
                id: createDepositDto.packageId,
                isActive: true
            }
        });

        if (!pkg || !pkg.isActive) {
            throw new NotFoundException('El paquete no existe o no está activo.');
        }

        //validar que el metodo de pago exista y este activo
        const paymentMethod = await this.prisma.paymentMethod.findFirst({
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

        if (!user) {
            throw new NotFoundException('El usuario no existe o no está activo.');
        }

        //subir al archivo usando el servicio de cloudinary
        const uploadResult = await this.cloudinaryService.uploadDepositPaymentProof({
            file,
            userId
        })

        //crear la solicitud(no SNAPSHOT de datos) de depósito en estado PENDING y usando el precio del paquete (pkg.price)
        return await this.prisma.depositRequest.create({
            data: {
                userId,
                packageId: createDepositDto.packageId,
                paymentMethodId: createDepositDto.paymentMethodId,

                packageNameAtMoment: pkg.name,
                amount: pkg.price,
                creditsToDeliver: pkg.credits,

                status: DepositStatus.PENDING,
                receiptUrl: uploadResult.secureUrl,
                receiptPublicId: uploadResult.publicId,
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
