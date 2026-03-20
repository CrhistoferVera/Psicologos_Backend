import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { PrismaModule } from '../../prisma/prisma.module'; // Importante para usar la DB
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';

@Module({
    imports: [PrismaModule, CloudinaryModule],
    controllers: [DepositsController],
    providers: [DepositsService],
})
export class DepositsModule { }