import { Module } from '@nestjs/common';
import { PackageService } from './package.service';
import { PackageController } from './package.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SystemConfigModule } from '../../system-config/system-config.module';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [PackageController],
  providers: [PackageService],
})
export class PackageModule {}