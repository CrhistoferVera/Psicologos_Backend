import { Module } from '@nestjs/common';
import { AnfitrioneController } from './anfitrionas.controller';
import { AnfitrioneService } from './anfitrionas.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [AnfitrioneController],
  providers: [AnfitrioneService],
})
export class AnfitrioneModule {}
