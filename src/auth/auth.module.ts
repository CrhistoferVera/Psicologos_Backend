import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { MailModule } from 'src/mail/mail.module';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule,
    MailModule,
    // Configuración asíncrona del JWT (para leer .env)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' }, // Token dura 1 día
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy], // Agregamos JwtStrategy aquí
  exports: [AuthService],
})
export class AuthModule { }