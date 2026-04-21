import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaceMatchService } from './face-match.service';

@Module({
  imports: [ConfigModule],
  providers: [FaceMatchService],
  exports: [FaceMatchService],
})
export class KycModule {}
