import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/entities/user.entity';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CompleteProfessionalRegistrationDto } from './dto/complete-professional-registration.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { MailService } from '../mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PROFESSIONAL_ROLE } from '../common/professional-role';
import { ReferralsService } from '../referrals/referrals.service';
import { createUniqueReferralCode } from '../referrals/utils/referral-code.util';
import { FaceMatchService } from '../kyc/face-match.service';
import { deriveBillingFields } from '../common/phone-metadata.util';

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

type EmailVerifiedTokenPayload = {
  sub: string;
  type: 'email_verified';
  email: string;
};

@Injectable()
export class AuthService {
  private static readonly RESET_CODE_TTL_MS = 15 * 60 * 1000;
  private static readonly RESET_MAX_ATTEMPTS = 5;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly referralsService: ReferralsService,
    private readonly faceMatch: FaceMatchService,
  ) {}

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private getResetAttemptsKey(email: string) {
    return `reset_attempts_${email}`;
  }

  private resetGenericMessage() {
    return {
      message: 'Si el correo esta registrado, recibiras un codigo de recuperacion.',
    };
  }

  private buildResetCodeHash(email: string, code: string) {
    const secret = process.env.RESET_PASSWORD_CODE_SECRET ?? '';
    return createHash('sha256')
      .update(`${email}:${code}:${secret}`)
      .digest('hex');
  }

  private safeStringEqual(a: string, b: string) {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  async sendOtp(dto: SendOtpDto) {
    const email = this.normalizeEmail(dto.email);
    if (!email) throw new BadRequestException('El email es obligatorio');

    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.cacheManager.set(`otp_${email}`, code, 900000);

    const existing = await this.usersService.findOneByEmail(email);
    await this.mailService.sendOtpEmail(email, existing?.firstName ?? 'Usuario', code, 15);

    return { message: 'Codigo OTP enviado por correo. Expira en 15 minutos.' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const email = this.normalizeEmail(dto.email);
    if (!email) throw new BadRequestException('El email es obligatorio');

    const cached = await this.cacheManager.get<string>(`otp_${email}`);

    if (!cached || cached !== dto.code) {
      throw new BadRequestException('Codigo OTP invalido o expirado');
    }

    await this.cacheManager.del(`otp_${email}`);

    const user = await this.usersService.findOneByEmail(email);

    if (user) {
      const { password: _, ...userWithoutPass } = user;
      return this.generateTokenResponse(userWithoutPass);
    }

    const tempToken = this.jwtService.sign(
      {
        sub: email,
        type: 'email_verified',
        email,
      } as EmailVerifiedTokenPayload,
      { expiresIn: '60m' },
    );

    return { needsProfile: true, tempToken };
  }

  // Verifica el email via Google (sin OTP) y devuelve un token temporal
  // email_verified para continuar un registro (usuario o profesional).
  // Si el correo ya tiene cuenta, devuelve la sesion directamente.
  async verifyGoogleForRegistration(idToken: string) {
    const tokenInfo = await this.verifyGoogleIdToken(idToken);

    const email = tokenInfo.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('La cuenta de Google no incluye email');
    }
    if (tokenInfo.email_verified !== 'true') {
      throw new UnauthorizedException('Debes verificar tu email en Google');
    }

    const user = await this.usersService.findOneByEmail(email);
    if (user) {
      const { password: _, ...userWithoutPass } = user;
      return this.generateTokenResponse(userWithoutPass);
    }

    const tempToken = this.jwtService.sign(
      {
        sub: email,
        type: 'email_verified',
        email,
      } as EmailVerifiedTokenPayload,
      { expiresIn: '60m' },
    );

    return { needsProfile: true, tempToken };
  }

  async completeRegistration(dto: CompleteRegistrationDto) {
    const payload = this.verifyEmailToken(dto.tempToken);

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const email = payload.email;

    const existing = await this.usersService.findOneByEmail(email);
    if (existing) throw new ConflictException('El email ya esta registrado');

    const countryIso = (dto.country ?? '').trim().toUpperCase();
    if (!countryIso) throw new BadRequestException('El pais es obligatorio');
    const { billingRegion, preferredCurrency } = deriveBillingFields(countryIso);

    const requestedReferralCode = dto.referralCode?.trim();
    if (requestedReferralCode) {
      await this.referralsService.resolveReferrerByCode(requestedReferralCode);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const newUser = await this.usersService.create({
      country: countryIso,
      billingRegion,
      preferredCurrency,
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
    const payload = this.verifyEmailToken(dto.tempToken);

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const email = payload.email;
    const countryIso = (dto.country ?? '').trim().toUpperCase();
    if (!countryIso) throw new BadRequestException('El pais es obligatorio');
    const { billingRegion, preferredCurrency } = deriveBillingFields(countryIso);

    const [existingUser, existingCedula, existingUsername] = await Promise.all([
      this.usersService.findOneByEmail(email),
      this.prisma.professionalProfile.findUnique({ where: { cedula: dto.cedula } }),
      this.prisma.professionalProfile.findUnique({ where: { username: dto.username } }),
    ]);

    if (existingUser) {
      // Si ya es profesional pendiente de revisión, el registro se completó antes pero
      // el cliente no recibió la respuesta (network error). Devolvemos el token sin error.
      const isPendingProfessional =
        PROFESSIONAL_ROLE === existingUser.role ||
        existingUser.role === 'ANFITRIONA' as any;

      const existingProfile = isPendingProfessional
        ? await this.prisma.professionalProfile.findUnique({ where: { userId: existingUser.id } })
        : null;

      if (existingProfile) {
        const { password: _, ...userWithoutPass } = existingUser;
        return { ...this.generateTokenResponse(userWithoutPass), profile: existingProfile };
      }

      throw new ConflictException('Este correo ya tiene una cuenta registrada.');
    }
    if (existingCedula) throw new ConflictException('La cedula ya esta registrada.');
    if (existingUsername) throw new ConflictException('El nombre de usuario ya esta en uso.');

    const requestedReferralCode = dto.referralCode?.trim();
    if (requestedReferralCode) {
      await this.referralsService.resolveReferrerByCode(requestedReferralCode);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
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
          billingRegion,
          preferredCurrency,
          email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          country: countryIso,
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
          bio: dto.bio?.trim() || null,
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

  async loginWithGoogle(idToken: string, country?: string) {
    const tokenInfo = await this.verifyGoogleIdToken(idToken);

    const normalizedEmail = tokenInfo.email?.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('La cuenta de Google no incluye email');
    }

    if (tokenInfo.email_verified !== 'true') {
      throw new UnauthorizedException('Debes verificar tu email en Google');
    }

    let user: User | null = await this.usersService.findOneByEmail(normalizedEmail);

    if (!user) {
      // Email no encontrado — se crea una cuenta nueva para ese email.
      // Google ya verifico el correo, asi que no hace falta OTP. El pais elegido
      // en el registro define la region/moneda (igual que en el flujo por correo).
      const [firstName, lastName] = this.extractNames(tokenInfo);
      const countryIso = (country ?? '').trim().toUpperCase();
      const billing = countryIso ? deriveBillingFields(countryIso) : null;
      user = await this.usersService.create({
        email: normalizedEmail,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        country: countryIso || undefined,
        billingRegion: billing?.billingRegion,
        preferredCurrency: billing?.preferredCurrency,
        isProfileComplete: true,
      });
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
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);

    if (!user?.email) {
      return this.resetGenericMessage();
    }

    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + AuthService.RESET_CODE_TTL_MS);
    const codeHash = this.buildResetCodeHash(normalizedEmail, code);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: codeHash,
        resetPasswordExpiry: expiresAt,
      },
    });

    await this.cacheManager.del(this.getResetAttemptsKey(normalizedEmail));

    await this.mailService.sendPasswordResetEmail(
      user.email,
      user.firstName ?? 'Usuario',
      code,
      15,
    );

    return this.resetGenericMessage();
  }

  async resetPassword(dto: ResetPasswordDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const code = dto.code.trim();

    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (
      !user?.resetPasswordToken ||
      !user.resetPasswordExpiry ||
      user.resetPasswordExpiry.getTime() <= Date.now()
    ) {
      throw new BadRequestException('Codigo invalido o expirado');
    }

    const attemptsKey = this.getResetAttemptsKey(normalizedEmail);
    const existingAttempts = Number((await this.cacheManager.get<number>(attemptsKey)) ?? 0);
    if (existingAttempts >= AuthService.RESET_MAX_ATTEMPTS) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: null,
          resetPasswordExpiry: null,
        },
      });
      await this.cacheManager.del(attemptsKey);
      throw new BadRequestException('Codigo invalido o expirado');
    }

    const incomingHash = this.buildResetCodeHash(normalizedEmail, code);
    const isValidCode = this.safeStringEqual(incomingHash, user.resetPasswordToken);
    if (!isValidCode) {
      const nextAttempts = existingAttempts + 1;
      const ttlMs = Math.max(user.resetPasswordExpiry.getTime() - Date.now(), 1000);
      await this.cacheManager.set(attemptsKey, nextAttempts, ttlMs);
      if (nextAttempts >= AuthService.RESET_MAX_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            resetPasswordToken: null,
            resetPasswordExpiry: null,
          },
        });
        await this.cacheManager.del(attemptsKey);
      }
      throw new BadRequestException('Codigo invalido o expirado');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
      },
    });
    await this.cacheManager.del(attemptsKey);

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

  private verifyEmailToken(token: string): EmailVerifiedTokenPayload {
    let payload: EmailVerifiedTokenPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new BadRequestException('Token invalido o expirado');
    }

    if (payload.type !== 'email_verified' || !payload.sub || !payload.email) {
      throw new BadRequestException('Token invalido');
    }

    return {
      ...payload,
      email: this.normalizeEmail(payload.email),
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
      this.logger.error(
        'Google Login sin configurar: define GOOGLE_MOBILE_WEB_CLIENT_ID y/o GOOGLE_MOBILE_IOS_CLIENT_ID en el backend.',
      );
      throw new UnauthorizedException(
        'Google Login no esta configurado en el servidor',
      );
    }

    if (
      (!tokenInfo.aud || !allowedAudiences.includes(tokenInfo.aud))
    ) {
      this.logger.warn(
        `Google aud no autorizado. aud recibido="${tokenInfo.aud ?? '(vacio)'}" | permitidos=[${allowedAudiences.join(', ')}]`,
      );
      throw new UnauthorizedException('Google Client ID no autorizado');
    }

    return tokenInfo as GoogleVerifiedTokenInfo;
  }

  private getAllowedGoogleAudiences() {
    return [
      process.env.GOOGLE_MOBILE_WEB_CLIENT_ID,
      process.env.GOOGLE_MOBILE_IOS_CLIENT_ID,
    ].filter((v): v is string => Boolean(v?.trim()));
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








