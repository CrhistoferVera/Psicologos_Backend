import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

@Injectable()
export class FlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private buildExternalUrl(template: string, payload: {
    userId: string;
    packageId: string;
    amount: number;
    credits: number;
  }) {
    const placeholders = ['{userId}', '{packageId}', '{amount}', '{credits}'];
    let url = template;

    for (const [key, value] of Object.entries(payload)) {
      url = url.replace(new RegExp(`\\{${key}\\}`, 'g'), encodeURIComponent(String(value)));
    }

    const hasPlaceholder = placeholders.some((placeholder) => template.includes(placeholder));

    if (!hasPlaceholder) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}userId=${encodeURIComponent(payload.userId)}&packageId=${encodeURIComponent(
        payload.packageId,
      )}&amount=${encodeURIComponent(payload.amount)}&credits=${encodeURIComponent(payload.credits)}`;
    }

    return url;
  }

  private buildSupportWhatsApp(phone: string, payload: {
    packageName: string;
    amount: number;
    credits: number;
    userId: string;
  }) {
    const normalized = phone.replace(/[^\d+]/g, '');
    const message = [
      'Hola, quiero recargar creditos.',
      `Paquete: ${payload.packageName}`,
      `Creditos: ${payload.credits}`,
      `Monto: ${payload.amount}`,
      `Usuario: ${payload.userId}`,
    ].join('\n');

    return `https://wa.me/${encodeURIComponent(normalized)}?text=${encodeURIComponent(message)}`;
  }

  async createPaymentUrl(userId: string, packageId: string) {
    const paymentsEnabled = await this.systemConfigService.isPaymentsEnabled();
    if (!paymentsEnabled) {
      throw new BadRequestException('Las recargas estan temporalmente deshabilitadas.');
    }

    const pkg = await this.prisma.package.findFirst({
      where: {
        id: packageId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        credits: true,
        price: true,
      },
    });

    if (!pkg) {
      throw new NotFoundException('El paquete no existe o no esta activo.');
    }

    const amount = Number(pkg.price);
    const credits = Number(pkg.credits);

    const checkoutTemplate =
      process.env.FLOW_CHECKOUT_URL_TEMPLATE ??
      process.env.FLOW_CHECKOUT_URL ??
      process.env.PAYMENT_CHECKOUT_URL;

    if (checkoutTemplate && checkoutTemplate.trim().length > 0) {
      return {
        paymentUrl: this.buildExternalUrl(checkoutTemplate.trim(), {
          userId,
          packageId: pkg.id,
          amount,
          credits,
        }),
        mode: 'CHECKOUT',
        package: {
          id: pkg.id,
          name: pkg.name,
          amount,
          credits,
        },
      };
    }

    const supportPhone = process.env.PAYMENT_SUPPORT_WHATSAPP ?? process.env.WHATSAPP_NUMBER;

    if (supportPhone && supportPhone.trim().length > 0) {
      return {
        paymentUrl: this.buildSupportWhatsApp(supportPhone, {
          packageName: pkg.name,
          amount,
          credits,
          userId,
        }),
        mode: 'SUPPORT_WHATSAPP',
        package: {
          id: pkg.id,
          name: pkg.name,
          amount,
          credits,
        },
      };
    }

    throw new ServiceUnavailableException(
      'No existe configuracion de checkout ni canal de soporte para recargas.',
    );
  }
}

