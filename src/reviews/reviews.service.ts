import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      select: { id: true, clientId: true, professionalId: true, scheduledEndAt: true },
    });

    if (!booking) throw new NotFoundException('Reserva no encontrada.');
    if (booking.clientId !== clientId) throw new ForbiddenException('No puedes calificar esta sesion.');
    if (booking.scheduledEndAt > new Date()) {
      throw new BadRequestException('La sesion aun no ha terminado.');
    }

    const existing = await this.prisma.bookingReview.findUnique({
      where: { bookingId: dto.bookingId },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Ya existe una reseña para esta sesion.');

    return this.prisma.bookingReview.create({
      data: {
        bookingId: dto.bookingId,
        clientId,
        professionalId: booking.professionalId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
      select: { id: true, rating: true, comment: true, createdAt: true },
    });
  }

  async findByProfessional(professionalId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.bookingReview.findMany({
        where: { professionalId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          client: {
            select: {
              firstName: true,
              lastName: true,
              userProfile: { select: { avatarUrl: true } },
            },
          },
        },
      }),
      this.prisma.bookingReview.count({ where: { professionalId } }),
    ]);

    const formatted = data.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      client: {
        name: [r.client.firstName, r.client.lastName].filter(Boolean).join(' ') || 'Anónimo',
        avatarUrl: r.client.userProfile?.avatarUrl ?? null,
      },
    }));

    return { data: formatted, total, page, limit };
  }
}
