import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CompleteProfessionalRegistrationDto } from './dto/complete-professional-registration.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-otp')
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phoneNumber);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phoneNumber, dto.code);
  }

  @Post('complete-registration')
  async completeRegistration(@Body() dto: CompleteRegistrationDto) {
    return this.authService.completeRegistration(dto);
  }

  @Post('complete-professional-registration')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'idDoc', maxCount: 1 },
      { name: 'kycVideo', maxCount: 1 },
      { name: 'kycSelfie', maxCount: 1 },
      { name: 'matricula', maxCount: 1 },
      { name: 'tituloProfesional', maxCount: 1 },
    ]),
  )
  async completeProfessionalRegistration(
    @Body() dto: CompleteProfessionalRegistrationDto,
    @UploadedFiles()
    files?: {
      idDoc?: Express.Multer.File[];
      kycVideo?: Express.Multer.File[];
      kycSelfie?: Express.Multer.File[];
      matricula?: Express.Multer.File[];
      tituloProfesional?: Express.Multer.File[];
    },
  ) {
    return this.authService.completeProfessionalRegistration(dto, {
      idDoc: files?.idDoc?.[0],
      kycVideo: files?.kycVideo?.[0],
      kycSelfie: files?.kycSelfie?.[0],
      matricula: files?.matricula?.[0],
      tituloProfesional: files?.tituloProfesional?.[0],
    });
  }
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Email o contrasena incorrectos');
    }
    return this.authService.login(user);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}

