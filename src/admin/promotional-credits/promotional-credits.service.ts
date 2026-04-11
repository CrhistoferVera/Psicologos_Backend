import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GrantPromotionalCreditsDto } from './dto/grant-promotional-credits.dto';
import { TransactionType, UserRole } from '@prisma/client';

@Injectable()
export class PromotionalCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async grantCredits(adminUserId: string, dto: GrantPromotionalCreditsDto) {
    if (adminUserId === dto.userId) {
      throw new BadRequestException('No puedes autoasignarte créditos promocionales.');
    }

    const recipient = await this.prisma.user.findFirst({
      where: { id: dto.userId, role: UserRole.USER, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!recipient) {
      throw new NotFoundException('Usuario destinatario no encontrado o no elegible.');
    }

    const amount = Math.round(dto.amount * 100) / 100;

    const result = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: dto.userId },
        update: {
          balance: { increment: amount },
          promotionalBalance: { increment: amount },
        },
        create: {
          userId: dto.userId,
          balance: amount,
          promotionalBalance: amount,
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.PROMOTIONAL_GRANT,
          amount,
          promotionalAmount: amount,
          realAmount: 0,
          isPromotional: true,
          description: dto.reason?.trim() || 'Créditos promocionales otorgados por administrador',
        },
      });

      const grant = await tx.promotionalCreditGrant.create({
        data: {
          adminUserId,
          recipientUserId: dto.userId,
          transactionId: transaction.id,
          amount,
          reason: dto.reason?.trim() || null,
        },
      });

      return { wallet, transaction, grant };
    });

    return {
      grantId: result.grant.id,
      userId: dto.userId,
      amount,
      wallet: {
        balance: Number(result.wallet.balance),
        promotionalBalance: Number(result.wallet.promotionalBalance),
        realBalance: Number(result.wallet.balance) - Number(result.wallet.promotionalBalance),
      },
      reason: dto.reason ?? null,
      createdAt: result.grant.createdAt,
    };
  }

  async listGrants(limit = 50, recipientUserId?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);

    const grants = await this.prisma.promotionalCreditGrant.findMany({
      where: recipientUserId ? { recipientUserId } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        adminUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        recipientUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return grants.map((g) => ({
      id: g.id,
      amount: Number(g.amount),
      reason: g.reason,
      createdAt: g.createdAt,
      admin: g.adminUser,
      recipient: g.recipientUser,
      transactionId: g.transactionId,
    }));
  }
}
