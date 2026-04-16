import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { FlowController } from './flow.controller';
import { FlowService } from './flow.service';

@Module({
  imports: [PrismaModule, SystemConfigModule],
  controllers: [FlowController],
  providers: [FlowService],
})
export class FlowModule {}
