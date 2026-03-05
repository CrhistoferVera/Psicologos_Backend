import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Country, CreateUserDto } from '../users/dto/create-user.dto';
import { v4 as uuidv4 } from 'uuid';
import { UserEntity } from '../users/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'src/mail/mail.service';
import { randomInt } from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache  ,
  ) { }

  async register(createUserDto: CreateUserDto) {
    if (!createUserDto.password) {
      throw new BadRequestException('La contraseña es requerida para el registro');
    }

    // Verificar que el email no exista ya en BD
    const existingUser = await this.usersService.findOneByEmail(createUserDto.email);
    if (existingUser) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Guardar datos del usuario en cache (no en BD)
    const userData = {
      ...createUserDto,
      password: hashedPassword,
      isOnboardingCompleted: true,
    };
    await this.cacheManager.set(`signup_${createUserDto.email}`, userData, 300000);

    // Enviar código de verificación al email
    await this.sendVerificationCode(createUserDto.email);

    return { message: 'Código de verificación enviado al correo electrónico' };
  }

  async verifySignup(email: string, code: string) {
    // Verificar el código OTP
    const result = await this.verifyCode(email, code);
    if (!result.verified) {
      throw new BadRequestException('Código de verificación inválido o expirado');
    }

    // Recuperar datos del usuario desde cache
    const userData = await this.cacheManager.get<CreateUserDto>(`signup_${email}`);
    if (!userData) {
      throw new BadRequestException('Datos de registro expirados. Por favor, regístrate nuevamente.');
    }

    // Crear el usuario en BD
    const newUser = await this.usersService.create(userData);

    // Limpiar cache de signup
    await this.cacheManager.del(`signup_${email}`);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = newUser;
    return this.login(userWithoutPassword);
  }

  async resendSignupCode(email: string) {
    // Verificar que existan datos de registro pendientes
    const userData = await this.cacheManager.get(`signup_${email}`);
    if (!userData) {
      throw new BadRequestException('No hay un registro pendiente para este correo');
    }

    // Reenviar código
    return this.sendVerificationCode(email);
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<Omit<UserEntity, 'password'> | null> {
    const user = await this.usersService.findOneByEmail(email);
    // Si el usuario no tiene password (cuenta de Google), no puede hacer login con email/password
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  login(user: Omit<UserEntity, 'password'>) {
    this.usersService.updateLastLogin(user.id);
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      kycStatus: user.kycStatus,
      isVerified: user.isVerified,
      walletAddress: user.walletAddress,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: new UserEntity(user),
    };
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findOneByEmail(email);
    if (!user)
      return {
        message:
          'Si el correo existe, se ha enviado un enlace para restablecer la contraseña.',
      };

    const token = uuidv4();
    const expires = new Date();
    expires.setHours(expires.getHours() + 1); // El token expira en 1 hora
    await this.usersService.update(user.id, {
      resetPasswordToken: token,
      resetPasswordExpiry: expires,
    });

    const resetlink =
      this.configService.get('FRONTEND_URL') + `/reset-password?token=${token}`;
    await this.mailService.sendPasswordReset(user.email, resetlink);

    return {
      message:
        'Si el correo existe, se ha enviado un enlace para restablecer la contraseña.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.usersService.findOneByResetToken(token);

    if (!user) throw new BadRequestException('Token inválido');
    if (!user.resetPasswordToken)
      throw new BadRequestException('Token inválido');
    if (!user.resetPasswordExpiry)
      throw new BadRequestException('Token inválido');

    // Verificar si expiró
    if (new Date() > user.resetPasswordExpiry) {
      throw new BadRequestException('El token ha expirado');
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar password y LIMPIAR el token
    await this.usersService.update(user.id, {
      password: hashedPassword,
      resetPasswordToken: null, // Importante limpiar
      resetPasswordExpiry: null, // Importante limpiar
    });
  }


  // auth.service.ts

  async validateUserByGoogle(profile: any) {
    // 1. Buscamos si ya existe por email
    const user = await this.usersService.findOneByEmail(profile.email);
    if (user) {
      // Si existe, retornamos el usuario para que genere el token
      return user;
    }

    // 2. Si NO existe, lo creamos
    console.log('Creando usuario nuevo desde Google...');

    const newUser = await this.usersService.create({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      password: '', // No se usa contraseña
      isGoogleAccount: true, // (Opcional) Útil para saber que no debe pedir cambio de pass
      country: Country.BOLIVIA, // O algún valor por defecto o lógica para asignar país
      isOnboardingCompleted: false,
    });

    return newUser;
  }

  // Reutiliza tu método login existente para generar el JWT
  async googleLogin(user: any) {
    // Llama a tu lógica de generar JWT que ya tienes
    return this.login(user);
  }

  //Funcion para enviar codigo de verificacion
  async sendVerificationCode(email: string){
    const n = randomInt(0, 1000000);
    //convertir a string y rellenar con ceros a la izquierda
    const code = n.toString().padStart(6, '0');
    //guardar en cache con expiracion de 5 minutos
    await this.cacheManager.set(`otp_${email}`, code, 300000);
    //enviar correo
    await this.mailService.send6DigitCode(email, code);
    return { message: 'Código de verificación enviado, expira en 5 minutos' };
  }

  async verifyCode(email: string, code: string){
    const cachedCode = await this.cacheManager.get(`otp_${email}`);
    if (cachedCode === code) {
      await this.cacheManager.del(`otp_${email}`);
      return { verified: true };
    }
    return { verified: false };
  }
}