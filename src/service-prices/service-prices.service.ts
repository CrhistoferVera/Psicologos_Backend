import { Injectable, NotFoundException } from '@nestjs/common';
import { ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { UpsertServicePriceDto } from './dto/upsert-service-price.dto';

@Injectable()
export class ServicePricesService {
  constructor(private readonly prisma: PrismaService) {}

  // Obtiene todos los precios de la anfitriona autenticada
  async getMyPrices(userId: string) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
      include: { servicePrices: true },
    });

    if (!profile) throw new NotFoundException('Perfil de anfitriona no encontrado');

    return profile.servicePrices;
  }

  // Crea o actualiza un precio para un tipo de servicio
  async upsertPrice(userId: string, dto: UpsertServicePriceDto) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId },
    });

    if (!profile) throw new NotFoundException('Perfil de anfitriona no encontrado');

    return this.prisma.servicePrice.upsert({
      where: {
        profileId_serviceType: {
          profileId: profile.id,
          serviceType: dto.serviceType,
        },
      },
      create: {
        profileId: profile.id,
        serviceType: dto.serviceType,
        price: dto.price,
      },
      update: {
        price: dto.price,
      },
    });
  }

  // Obtiene el precio activo de un servicio para una anfitriona (usado al enviar mensaje)
  async getPriceForUser(anfitrionaUserId: string, serviceType: ServiceType) {
    const profile = await this.prisma.anfitrioneProfile.findUnique({
      where: { userId: anfitrionaUserId },
      include: {
        servicePrices: {
          where: { serviceType },
        },
      },
    });

    return profile?.servicePrices[0] ?? null;
  }
}
