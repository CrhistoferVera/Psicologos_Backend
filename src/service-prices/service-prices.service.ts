import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { UpsertServicePriceDto } from './dto/upsert-service-price.dto';

@Injectable()
export class ServicePricesService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly minPriceByService: Record<ServiceType, number> = {
    [ServiceType.MESSAGE_SEND]: 0.1,
    [ServiceType.CALL]: 0.5,
    [ServiceType.VIDEO_CALL]: 1,
  };

  // Obtiene todos los precios del profesional autenticado.
  async getMyPrices(userId: string) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      include: { servicePrices: true },
    });

    if (!profile) throw new NotFoundException('Perfil profesional no encontrado');

    return profile.servicePrices;
  }

  // Crea o actualiza un precio para un tipo de servicio.
  async upsertPrice(userId: string, dto: UpsertServicePriceDto) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
    });

    if (!profile) throw new NotFoundException('Perfil profesional no encontrado');

    // Profesionales no habilitados para cobrar (verificados solo con CI) quedan en
    // modo gratuito: su tarifa se fuerza a 0 y no aplica el mínimo por servicio.
    const price = profile.canCharge ? dto.price : 0;

    if (profile.canCharge) {
      const minPrice = this.minPriceByService[dto.serviceType] ?? 0;
      if (dto.price <= minPrice) {
        const label =
          dto.serviceType === ServiceType.MESSAGE_SEND
            ? 'mensajes'
            : dto.serviceType === ServiceType.CALL
              ? 'llamadas'
              : 'videollamadas';
        throw new BadRequestException(
          `La tarifa para ${label} debe ser mayor a ${minPrice} créditos.`,
        );
      }
    }

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
        price,
      },
      update: {
        price,
      },
    });
  }

  // Precios publicos de un profesional.
  async getPublicPrices(professionalUserId: string) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: professionalUserId },
      include: { servicePrices: true },
    });
    return profile?.servicePrices ?? [];
  }

  // Obtiene el precio activo de un servicio para un profesional.
  async getPriceForUser(professionalUserId: string, serviceType: ServiceType) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: professionalUserId },
      include: {
        servicePrices: {
          where: { serviceType },
        },
      },
    });

    return profile?.servicePrices[0] ?? null;
  }
}

