import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { AnfitrioneModule } from './anfitrionas/anfitrionas.module';

import { PackageModule } from './admin/package/package.module';
import { ClientModule} from './admin/client/client.module';
import { AnfitrionaModule } from './admin/anfitriona/anfitriona.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ChatsModule } from './chats/chats.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    PackageModule,
    ClientModule,
    AnfitrionaModule,
    AuthModule,
    UsersModule,
    CloudinaryModule,
    AnfitrioneModule,
    ChatsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
