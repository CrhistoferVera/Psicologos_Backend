import { Module } from '@nestjs/common';
import { AdminConfigController } from './admin-config.controller';
import { SystemConfigModule } from '../../system-config/system-config.module';

@Module({
  imports: [SystemConfigModule],
  controllers: [AdminConfigController],
})
export class AdminConfigModule {}
