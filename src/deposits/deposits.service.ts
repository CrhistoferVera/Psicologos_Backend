import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepositRequestDto } from './dto/create-depositRequest.dto';
import { DepositStatus, UserRole } from '@prisma/client';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { SystemConfigService } from '../system-config/system-config.service';

@Injectable()
export class DepositsService {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async createDepositRequest(
    userId: string,
    createDepositDto: CreateDepositRequestDto,
    file: Express.Multer.File,
  ) {
    const paymentsEnabled = await this.systemConfigService.isPaymentsEnabled();
    if (!paymentsEnabled) {
      throw new BadRequestException('Las recargas estan temporalmente deshabilitadas.');
    }

    const pkg = await this.prisma.package.findFirst({
      where: {
        id: createDepositDto.packageId,
        isActive: true,
      },
    });

    if (!pkg || !pkg.isActive) {
      throw new NotFoundException('El paquete no existe o no esta activo.');
    }

    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: {
        id: createDepositDto.paymentMethodId,
        isActive: true,
      },
    });

    if (!paymentMethod || !paymentMethod.isActive) {
      throw new NotFoundException('El metodo de pago no existe o no esta activo.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('El usuario no existe o no esta activo.');
    }

    const uploadResult = await this.cloudinaryService.uploadDepositPaymentProof({
      file,
      userId,
    });

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
          },
        },
      },
    });
  }
}
