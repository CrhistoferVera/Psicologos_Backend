import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemConfigService } from './system-config.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
