import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeCapabilities, JwtUser } from '../../common/capabilities';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') as string,
    });
  }

  // Se resuelve el usuario fresco en cada request para que las capacidades
  // (ej. un profesional recién aprobado) y el modo activo estén siempre al día,
  // sin depender de re-emitir el token.
  async validate(payload: any): Promise<JwtUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        role: true,
        activeMode: true,
        isProfileComplete: true,
        professionalProfile: { select: { id: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    const capabilities = computeCapabilities({
      role: user.role,
      hasProfessionalProfile: Boolean(user.professionalProfile),
    });

    return {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role,
      activeMode: user.activeMode,
      isProfileComplete: user.isProfileComplete,
      capabilities,
    };
  }
}
