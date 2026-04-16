import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/entities/user.entity';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CompleteProfessionalRegistrationDto } from './dto/complete-professional-registration.dto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MailService } from '../mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PROFESSIONAL_ROLE } from '../common/professional-role';
import { ReferralsService } from '../referrals/referrals.service';
import { createUniqueReferralCode } from '../referrals/utils/referral-code.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly whatsappService: WhatsappService,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly referralsService: ReferralsService,
  ) {}

  async sendOtp(phoneNumber: string) {
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.cacheManager.set(`otp_${phoneNumber}`, code, 300000);

    await this.whatsappService.sendText(
      phoneNumber,
      `Tu codigo de verificacion es: *${code}*\nExpira en 5 minutos.`,
    );

    return { message: 'Codigo OTP enviado por WhatsApp. Expira en 5 minutos.' };
  }

  async verifyOtp(phoneNumber: string, code: string) {
    const cached = await this.cacheManager.get<string>(`otp_${phoneNumber}`);

    if (!cached || cached !== code) {
      throw new BadRequestException('Codigo OTP invalido o expirado');
    }

    await this.cacheManager.del(`otp_${phoneNumber}`);

    const user = await this.usersService.findOneByPhone(phoneNumber);

    if (user) {
      const { password: _, ...userWithoutPass } = user;
      return this.generateTokenResponse(userWithoutPass);
    }

    const tempToken = this.jwtService.sign(
      { sub: phoneNumber, type: 'phone_verified' },
      { expiresIn: '10m' },
    );

    return { needsProfile: true, tempToken };
  }

  async completeRegistration(dto: CompleteRegistrationDto) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(dto.tempToken);
    } catch {
      throw new BadRequestException('Token invalido o expirado');
    }

    if (payload.type !== 'phone_verified') {
      throw new BadRequestException('Token invalido');
    }

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const email = dto.email?.trim().toLowerCase();
    if (!email) throw new BadRequestException('El email es obligatorio');

    const existing = await this.usersService.findOneByEmail(email);
    if (existing) throw new ConflictException('El email ya esta registrado');

    const requestedReferralCode = dto.referralCode?.trim();
    if (requestedReferralCode) {
      await this.referralsService.resolveReferrerByCode(requestedReferralCode);
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

    if (requestedReferralCode) {
      await this.referralsService.createReferralLink(newUser.id, requestedReferralCode);
    }

    const { password: _, ...userWithoutPass } = newUser;
    return this.generateTokenResponse(userWithoutPass);
  }

  async completeProfessionalRegistration(
    dto: CompleteProfessionalRegistrationDto,
    idDocFile?: Express.Multer.File,
  ) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwtService.verify(dto.tempToken);
    } catch {
      throw new BadRequestException('Token invalido o expirado');
    }

    if (payload.type !== 'phone_verified') {
      throw new BadRequestException('Token invalido');
    }

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const [existingCedula, existingUsername, existingEmail] = await Promise.all([
      this.prisma.anfitrioneProfile.findUnique({ where: { cedula: dto.cedula } }),
      this.prisma.anfitrioneProfile.findUnique({ where: { username: dto.username } }),
      dto.email ? this.usersService.findOneByEmail(dto.email.trim().toLowerCase()) : null,
    ]);

    if (existingCedula) throw new ConflictException('La cedula ya esta registrada.');
    if (existingUsername) throw new ConflictException('El nombre de usuario ya esta en uso.');
    if (existingEmail) throw new ConflictException('El email ya esta registrado.');

    const requestedReferralCode = dto.referralCode?.trim();
    if (requestedReferralCode) {
      await this.referralsService.resolveReferrerByCode(requestedReferralCode);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const email = dto.email?.trim().toLowerCase();
    const referralCode = await createUniqueReferralCode(this.prisma, dto.firstName ?? dto.username);
    const newUser = await this.prisma.user.create({
      data: {
        phoneNumber: payload.sub,
        email: email ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        password: hashedPassword,
        role: PROFESSIONAL_ROLE,
        referralCode,
        isProfileComplete: true,
        isActive: false,
        wallet: { create: { balance: 0, promotionalBalance: 0 } },
      },
    });
    let idDocUrl: string | null = null;
    let idDocPublicId: string | null = null;

    if (idDocFile) {
      const uploaded = await this.cloudinary.uploadAnfitrioneIdDoc({
        file: idDocFile,
        userId: newUser.id,
      });
      idDocUrl = uploaded.secureUrl;
      idDocPublicId = uploaded.publicId;
    }

    const profile = await this.prisma.anfitrioneProfile.create({
      data: {
        userId: newUser.id,
        dateOfBirth: new Date(dto.dateOfBirth),
        cedula: dto.cedula,
        username: dto.username,
        idDocUrl,
        idDocPublicId,
        reviewStatus: 'PENDING',
      },
    });

    if (requestedReferralCode) {
      await this.referralsService.createReferralLink(newUser.id, requestedReferralCode);
    }

    const { password: _, ...userWithoutPass } = newUser;
    return {
      ...this.generateTokenResponse(userWithoutPass),
      profile,
    };
  }

  async validateUser(email: string, pass: string): Promise<Omit<User, 'password'> | null> {
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

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersService.findOneByEmail(normalizedEmail);

    if (!user || !user.email) {
      return { message: 'Si el correo esta registrado, recibiras un codigo.' };
    }

    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.cacheManager.set(`reset_${normalizedEmail}`, code, 900000);

    await this.mailService.sendPasswordResetEmail(
      user.email,
      user.firstName ?? 'Usuario',
      code,
    );

    return { message: 'Si el correo esta registrado, recibiras un codigo.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const cached = await this.cacheManager.get<string>(`reset_${normalizedEmail}`);

    if (!cached || cached !== dto.code) {
      throw new BadRequestException('Codigo invalido o expirado');
    }

    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.update(user.id, { password: hashedPassword });
    await this.cacheManager.del(`reset_${normalizedEmail}`);

    return { message: 'Contrasena actualizada correctamente' };
  }

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







