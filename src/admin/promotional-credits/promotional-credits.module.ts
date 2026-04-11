import { Module } from '@nestjs/common';
import { PromotionalCreditsController } from './promotional-credits.controller';
import { PromotionalCreditsService } from './promotional-credits.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PromotionalCreditsController],
  providers: [PromotionalCreditsService],
  exports: [PromotionalCreditsService],
})
export class PromotionalCreditsModule {}
