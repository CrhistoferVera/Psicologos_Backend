import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserEntity } from '../users/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { randomInt } from 'crypto';
import type { User } from '@prisma/client';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MailService } from '../mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private whatsappService: WhatsappService,
    private mailService: MailService,
  ) {}

  // ─── OTP FLOW ─────────────────────────────────────────────────────────────

  async sendOtp(phoneNumber: string) {
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.cacheManager.set(`otp_${phoneNumber}`, code, 300000); // 5 min

    await this.whatsappService.sendText(
      phoneNumber,
      `Tu código de verificación de Pachamama es: *${code}*\nExpira en 5 minutos.`,
    );

    return { message: 'Código OTP enviado por WhatsApp. Expira en 5 minutos.' };
  }

  async verifyOtp(phoneNumber: string, code: string) {
    const cached = await this.cacheManager.get<string>(`otp_${phoneNumber}`);

    if (!cached || cached !== code) {
      throw new BadRequestException('Código OTP inválido o expirado');
    }

    await this.cacheManager.del(`otp_${phoneNumber}`);

    const user = await this.usersService.findOneByPhone(phoneNumber);

    if (user) {
      // Usuario existente → retornar JWT
      const { password: _, ...userWithoutPass } = user;
      return this.generateTokenResponse(userWithoutPass);
    }

    // Usuario nuevo → retornar token temporal para completar el registro
    const tempToken = this.jwtService.sign(
      { sub: phoneNumber, type: 'phone_verified' },
      { expiresIn: '10m' },
    );

    return { needsProfile: true, tempToken };
  }

  async completeRegistration(dto: CompleteRegistrationDto) {
    // Validar token temporal
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(dto.tempToken);
    } catch {
      throw new BadRequestException('Token inválido o expirado');
    }

    if (payload.type !== 'phone_verified') {
      throw new BadRequestException('Token inválido');
    }

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const email = dto.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('El email es obligatorio');
    }

    const existing = await this.usersService.findOneByEmail(email);
    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const newUser = await this.usersService.create({
      phoneNumber: payload.sub,
      email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: hashedPassword,
      isProfileComplete: true,
    });

    const { password: _, ...userWithoutPass } = newUser;
    return this.generateTokenResponse(userWithoutPass);
  }

  // ─── EMAIL/PASSWORD LOGIN (secundario) ────────────────────────────────────

  async validateUser(
    email: string,
    pass: string,
  ): Promise<Omit<User, 'password'> | null> {
    const user = await this.usersService.findOneByEmail(email);
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  login(user: Omit<User, 'password'>) {
    return this.generateTokenResponse(user);
  }

  // ─── FORGOT PASSWORD ──────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersService.findOneByEmail(normalizedEmail);

    // Siempre respondemos igual para no revelar si el email existe
    if (!user || !user.email) {
      return { message: 'Si el correo está registrado, recibirás un código.' };
    }

    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.cacheManager.set(`reset_${normalizedEmail}`, code, 900000); // 15 min

    await this.mailService.sendPasswordResetEmail(
      user.email,
      user.firstName ?? 'Usuario',
      code,
    );

    return { message: 'Si el correo está registrado, recibirás un código.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const cached = await this.cacheManager.get<string>(`reset_${normalizedEmail}`);

    if (!cached || cached !== dto.code) {
      throw new BadRequestException('Código inválido o expirado');
    }

    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.update(user.id, { password: hashedPassword });
    await this.cacheManager.del(`reset_${normalizedEmail}`);

    return { message: 'Contraseña actualizada correctamente' };
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  private generateTokenResponse(user: Omit<User, 'password'>) {
    this.usersService.updateLastLogin(user.id);

    const payload = {
      sub: user.id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role,
      isProfileComplete: user.isProfileComplete,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: new UserEntity(user),
    };
  }
}


