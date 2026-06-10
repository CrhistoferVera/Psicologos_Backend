import { Module } from '@nestjs/common';
import { AdminProfessionalsService } from './professionals.service';
import { AdminProfessionalsController } from './professionals.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [AdminProfessionalsController],
  providers: [AdminProfessionalsService],
})
export class AdminProfessionalsModule {}

