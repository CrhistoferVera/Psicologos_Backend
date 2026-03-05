import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifySignupDto } from './dto/verify-signup.dto';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService,
  ) { }

  // 1. REGISTRO (Sign Up)
  // Ruta: POST /auth/signup
  @Post('signup')
  async signup(@Body() createUserDto: CreateUserDto) {
    // Llama al servicio que hashea la password y guarda en la BD

    return this.authService.register(createUserDto);
  }

  // VERIFICAR CÓDIGO DE SIGNUP
  @Post('verify-signup')
  @HttpCode(HttpStatus.OK)
  async verifySignup(@Body() verifySignupDto: VerifySignupDto) {
    return this.authService.verifySignup(verifySignupDto.email, verifySignupDto.code);
  }

  // REENVIAR CÓDIGO DE VERIFICACIÓN
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  async resendCode(@Body() body: ForgotPasswordDto) {
    return this.authService.resendSignupCode(body.email);
  }

  // 2. INICIO DE SESIÓN (Login)
  // Ruta: POST /auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK) // Cambiamos el código por defecto (201) a 200 OK
  async login(@Body() loginDto: LoginDto) {
    // A. Validar que el usuario existe y la contraseña es correcta
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      throw new UnauthorizedException(
        'Credenciales inválidas (Email o contraseña incorrectos)',
      );
    }

    // B. Si todo está bien, generamos y devolvemos el Token JWT
    return this.authService.login(user);
  }

  // 3. OLVIDÉ MI CONTRASEÑA
  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    await this.authService.resetPassword(body.token, body.newPassword);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) { }

  // 2. Google devuelve al usuario aquí
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    // req.user viene con el perfil de Google, necesitamos buscar/crear en BD
    const user = await this.authService.validateUserByGoogle(req.user);
    const data = await this.authService.googleLogin(user);
    const isCompleted = data.user.isOnboardingCompleted;
    if (isCompleted) {
      // Usuario antiguo -> Al Dashboard directo
      res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${data.access_token}&dest=/dashboard`);
    } else {
      // Usuario nuevo -> A completar perfil
      res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${data.access_token}&dest=/complete-profile`);
    }
  }
}