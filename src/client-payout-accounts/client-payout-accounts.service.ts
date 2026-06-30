import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RefundMethod } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreatePayoutAccountDto } from './dto/create-payout-account.dto';

@Injectable()
export class ClientPayoutAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreatePayoutAccountDto) {
    this.assertRequiredFields(dto);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.clientPayoutAccount.updateMany({
          where: { clientId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.clientPayoutAccount.create({
        data: {
          clientId,
          method: dto.method,
          isDefault: dto.isDefault ?? false,
          bankName: dto.bankName ?? null,
          bankAccountNumber: dto.bankAccountNumber ?? null,
          bankAccountHolder: dto.bankAccountHolder ?? null,
          cryptoAddress: dto.cryptoAddress ?? null,
          cryptoCurrency: dto.cryptoCurrency ?? null,
          cryptoNetwork: dto.cryptoNetwork ?? null,
        },
      });
    });
  }

  async findAllByClient(clientId: string) {
    return this.prisma.clientPayoutAccount.findMany({
      where: { clientId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async remove(clientId: string, accountId: string) {
    const account = await this.prisma.clientPayoutAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        clientId: true,
        refundRequests: {
          where: { status: { not: 'REJECTED' } },
          select: { id: true },
        },
      },
    });

    if (!account) throw new NotFoundException('Cuenta de pago no encontrada.');
    if (account.clientId !== clientId) throw new ForbiddenException('No tienes permisos sobre esta cuenta.');

    if (account.refundRequests.length > 0) {
      throw new BadRequestException('No puedes eliminar una cuenta con solicitudes de reembolso activas.');
    }

    await this.prisma.clientPayoutAccount.delete({ where: { id: accountId } });
    return { success: true };
  }

  private assertRequiredFields(dto: CreatePayoutAccountDto) {
    if (dto.method === RefundMethod.BANK_TRANSFER) {
      if (!dto.bankName || !dto.bankAccountNumber || !dto.bankAccountHolder) {
        throw new BadRequestException(
          'Para transferencia bancaria se requieren bankName, bankAccountNumber y bankAccountHolder.',
        );
      }
    }

    if (dto.method === RefundMethod.CRYPTO) {
      if (!dto.cryptoAddress || !dto.cryptoCurrency || !dto.cryptoNetwork) {
        throw new BadRequestException(
          'Para crypto se requieren cryptoAddress, cryptoCurrency y cryptoNetwork.',
        );
      }
    }
  }
}
