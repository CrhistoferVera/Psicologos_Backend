import { Module } from '@nestjs/common';
import { AdminProfessionalsService } from './professionals.service';
import { AdminProfessionalsController } from './professionals.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { ProfessionalPerfilService } from '../../professionals/professional.perfil.service';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [AdminProfessionalsController],
  providers: [AdminProfessionalsService, ProfessionalPerfilService],
})
export class AdminProfessionalsModule {}

