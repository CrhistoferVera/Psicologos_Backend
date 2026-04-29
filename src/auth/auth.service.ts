import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
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
import { FaceMatchService } from '../kyc/face-match.service';

type GoogleTokenInfo = {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  exp?: string;
};

type GoogleVerifiedTokenInfo = GoogleTokenInfo & {
  sub: string;
};

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
    private readonly faceMatch: FaceMatchService,
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
    files?: {
      idDoc?: Express.Multer.File;
      kycVideo?: Express.Multer.File;
      kycSelfie?: Express.Multer.File;
      matricula?: Express.Multer.File;
      tituloProfesional?: Express.Multer.File;
    },
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

    const [existingPhone, existingCedula, existingUsername, existingEmail] = await Promise.all([
      this.prisma.user.findUnique({ where: { phoneNumber: payload.sub } }),
      this.prisma.professionalProfile.findUnique({ where: { cedula: dto.cedula } }),
      this.prisma.professionalProfile.findUnique({ where: { username: dto.username } }),
      dto.email ? this.usersService.findOneByEmail(dto.email.trim().toLowerCase()) : null,
    ]);

    if (existingPhone) {
      // Si ya es profesional pendiente de revisión, el registro se completó antes pero
      // el cliente no recibió la respuesta (network error). Devolvemos el token sin error.
      const isPendingProfessional =
        PROFESSIONAL_ROLE === existingPhone.role ||
        existingPhone.role === 'ANFITRIONA' as any;

      const existingProfile = isPendingProfessional
        ? await this.prisma.professionalProfile.findUnique({ where: { userId: existingPhone.id } })
        : null;

      if (existingProfile) {
        const { password: _, ...userWithoutPass } = existingPhone;
        return { ...this.generateTokenResponse(userWithoutPass), profile: existingProfile };
      }

      throw new ConflictException('Este número de teléfono ya tiene una cuenta registrada.');
    }
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

    // Generate ID upfront so Cloudinary uploads can use it before any DB write
    const uid = randomUUID();

    // Upload all KYC files first — if this fails, no user is left in the DB
    const [idDocResult, kycVideoResult, kycSelfieResult, matriculaResult, tituloResult] =
      await Promise.all([
        files?.idDoc
          ? this.cloudinary.uploadProfessionalIdDoc({ file: files.idDoc, userId: uid })
          : null,
        files?.kycVideo
          ? this.cloudinary.uploadKycFile({ file: files.kycVideo, userId: uid, folder: 'kyc/video', publicIdPrefix: 'kyc_video' })
          : null,
        files?.kycSelfie
          ? this.cloudinary.uploadKycFile({ file: files.kycSelfie, userId: uid, folder: 'kyc/selfie', publicIdPrefix: 'kyc_selfie' })
          : null,
        files?.matricula
          ? this.cloudinary.uploadKycFile({ file: files.matricula, userId: uid, folder: 'kyc/matricula', publicIdPrefix: 'matricula' })
          : null,
        files?.tituloProfesional
          ? this.cloudinary.uploadKycFile({ file: files.tituloProfesional, userId: uid, folder: 'kyc/titulo', publicIdPrefix: 'titulo' })
          : null,
      ]);

    // Automatic face comparison: selfie thumbnail vs ID document
    let faceMatchScore: number | null = null;
    let kycFaceMatchStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';

    if (files?.kycSelfie && files?.idDoc?.mimetype.startsWith('image/')) {
      const result = await this.faceMatch.compareFaces(
        files.kycSelfie.buffer,
        files.idDoc.buffer,
      );
      faceMatchScore = result.score;
      kycFaceMatchStatus = result.status;
    }

    // Create user + wallet + profile atomically — if anything fails, nothing is committed
    const { newUser, profile } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: uid,
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

      const prof = await tx.professionalProfile.create({
        data: {
          userId: uid,
          dateOfBirth: new Date(dto.dateOfBirth),
          cedula: dto.cedula,
          username: dto.username,
          idDocUrl: idDocResult?.secureUrl ?? null,
          idDocPublicId: idDocResult?.publicId ?? null,
          kycVideoUrl: kycVideoResult?.secureUrl ?? null,
          kycVideoPublicId: kycVideoResult?.publicId ?? null,
          kycSelfieUrl: kycSelfieResult?.secureUrl ?? null,
          kycSelfiePublicId: kycSelfieResult?.publicId ?? null,
          matriculaUrl: matriculaResult?.secureUrl ?? null,
          matriculaPublicId: matriculaResult?.publicId ?? null,
          tituloProfesionalUrl: tituloResult?.secureUrl ?? null,
          tituloProfesionalPublicId: tituloResult?.publicId ?? null,
          kycFaceMatchScore: faceMatchScore,
          kycFaceMatchStatus,
          reviewStatus: 'PENDING',
        },
      });

      return { newUser: user, profile: prof };
    });

    if (requestedReferralCode) {
      await this.referralsService.createReferralLink(uid, requestedReferralCode);
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

  async loginWithGoogle(idToken: string) {
    const tokenInfo = await this.verifyGoogleIdToken(idToken);

    const normalizedEmail = tokenInfo.email?.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('La cuenta de Google no incluye email');
    }

    if (tokenInfo.email_verified !== 'true') {
      throw new UnauthorizedException('Debes verificar tu email en Google');
    }

    const googlePhoneNumber = this.buildGooglePhoneNumber(tokenInfo.sub);
    const [userByGooglePhone, userByEmail] = await Promise.all([
      this.usersService.findOneByPhone(googlePhoneNumber),
      this.usersService.findOneByEmail(normalizedEmail),
    ]);

    let user: User | null = null;

    if (userByGooglePhone) {
      const needsEmailUpdate =
        !userByGooglePhone.email ||
        userByGooglePhone.email.toLowerCase() !== normalizedEmail;

      if (needsEmailUpdate && userByEmail && userByEmail.id !== userByGooglePhone.id) {
        throw new ConflictException(
          'El email de Google ya esta asociado a otra cuenta',
        );
      }

      if (needsEmailUpdate) {
        user = await this.usersService.update(userByGooglePhone.id, {
          email: normalizedEmail,
        });
      } else {
        user = userByGooglePhone;
      }
    } else if (userByEmail) {
      user = userByEmail;
    } else {
      const [firstName, lastName] = this.extractNames(tokenInfo);
      user = await this.usersService.create({
        phoneNumber: googlePhoneNumber,
        email: normalizedEmail,
        firstName,
        lastName,
        isProfileComplete: true,
      });
    }

    if (!user) {
      throw new UnauthorizedException('No se pudo autenticar con Google');
    }

    const shouldSyncName =
      (!user.firstName || !user.lastName) &&
      (tokenInfo.given_name || tokenInfo.family_name || tokenInfo.name);

    if (shouldSyncName) {
      const [firstName, lastName] = this.extractNames(tokenInfo);
      user = await this.usersService.update(user.id, {
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      });
    }

    const { password: _, ...userWithoutPass } = user;
    return this.generateTokenResponse(userWithoutPass);
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

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleVerifiedTokenInfo> {
    const verifyUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
    verifyUrl.searchParams.set('id_token', idToken);

    const response = await fetch(verifyUrl.toString());
    if (!response.ok) {
      throw new UnauthorizedException('Token de Google invalido o expirado');
    }

    const tokenInfo = (await response.json()) as GoogleTokenInfo;
    if (!tokenInfo.sub) {
      throw new UnauthorizedException('Token de Google invalido');
    }

    const issuer = tokenInfo.iss ?? '';
    const isValidIssuer =
      issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com';
    if (!isValidIssuer) {
      throw new UnauthorizedException('Issuer de Google no valido');
    }

    const allowedAudiences = this.getAllowedGoogleAudiences();
    if (allowedAudiences.length === 0) {
      throw new UnauthorizedException(
        'Google Login no esta configurado en el servidor',
      );
    }

    if (
      (!tokenInfo.aud || !allowedAudiences.includes(tokenInfo.aud))
    ) {
      throw new UnauthorizedException('Google Client ID no autorizado');
    }

    return tokenInfo as GoogleVerifiedTokenInfo;
  }

  private getAllowedGoogleAudiences() {
    const raw = process.env.GOOGLE_CLIENT_IDS ?? process.env.GOOGLE_CLIENT_ID ?? '';
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private buildGooglePhoneNumber(googleSub?: string) {
    if (!googleSub) {
      throw new UnauthorizedException('No se pudo identificar la cuenta de Google');
    }
    return `google_${googleSub}`;
  }

  private extractNames(tokenInfo: GoogleTokenInfo): [string | undefined, string | undefined] {
    const firstName = tokenInfo.given_name?.trim();
    const familyName = tokenInfo.family_name?.trim();

    if (firstName || familyName) {
      return [firstName || undefined, familyName || undefined];
    }

    const fullName = tokenInfo.name?.trim();
    if (!fullName) return [undefined, undefined];

    const [first, ...rest] = fullName.split(' ').filter(Boolean);
    const last = rest.join(' ').trim();
    return [first || undefined, last || undefined];
  }
}








