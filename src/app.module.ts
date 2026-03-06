import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma.module';

import { PackageModule } from './admin/package/package.module';
import { ClientModule} from './admin/client/client.module';
import { AnfitrionaModule } from './admin/anfitriona/anfitriona.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    PackageModule,
    ClientModule,
    AnfitrionaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
