import { Module } from '@nestjs/common';
import { SpecialtyController } from './specialty.controller';
import { PublicSpecialtyController } from './public-specialty.controller';
import { SpecialtyService } from './specialty.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SpecialtyController, PublicSpecialtyController],
  providers: [SpecialtyService],
  exports: [SpecialtyService],
})
export class SpecialtyModule {}
