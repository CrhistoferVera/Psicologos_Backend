import {
  Controller,
  Get,
  Param,
  UseInterceptors,
  ClassSerializerInterceptor,
  NotFoundException,
  UseGuards,
  Body,
  BadRequestException,
  ConflictException,
  Patch,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserEntity } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KycStatus, UserRole } from '@prisma/client';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { AuthService } from '../auth/auth.service'; 
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { EditPhoneNumberDto } from './dto/edit-phone-number.dto';
import { EditPasswordDto } from './dto/edit-password.dto';
import * as bcrypt from 'bcrypt';
 
interface JwtUser {
  userId: string;
  email: string;
  role: UserRole;
  kycStatus: KycStatus;
  isVerified: boolean;
}

@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService,
    private readonly authService: AuthService
  ) { }

  // Obtener mi propio perfil (Ruta Protegida)
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: JwtUser) {
    const foundUser = await this.usersService.findOneById(user.userId);
    if (!foundUser) throw new NotFoundException('Usuario no encontrado');
    return new UserEntity(foundUser);
  }

  // Obtener usuario por ID (Admin o público según tu lógica)
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserEntity> {
    const user = await this.usersService.findOneById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return new UserEntity(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('link-wallet')
  async linkWallet(
    @CurrentUser() user: JwtUser,
    @Body() body: LinkWalletDto,
  ) {
    if (!body.walletAddress) {
      throw new BadRequestException(
        'La dirección de la billetera es obligatoria',
      );
    }

    // Verificar la contraseña antes de vincular la billetera
    const validUser = await this.authService.validateUser(
      user.email,
      body.password,
    );
    if (!validUser) {
      throw new BadRequestException('Contraseña incorrecta');
    }
    // Verificar si la wallet ya está vinculada a otra cuenta
    const existingUser = await this.usersService.findOneByWalletAddress(body.walletAddress);
    if (existingUser && existingUser.id !== user.userId) {
      throw new ConflictException('Esta billetera ya está vinculada a otra cuenta');
    }

    // Actualizar la dirección de la billetera en el perfil del usuario
    const updatedUser = await this.usersService.update(user.userId, {
      walletAddress: body.walletAddress,
    });
    return {
      success: true,
      message: 'Billetera vinculada correctamente',
      walletAddress: updatedUser.walletAddress
    };
  }

  @Patch('complete-profile')
  @UseGuards(JwtAuthGuard)
  async completeProfile(@CurrentUser() user: JwtUser, @Body() body: CompleteProfileDto) {
    const hashedPassword = await bcrypt.hash(body.password, 10);

    const updatedUser = await this.usersService.update(user.userId, {
      password: hashedPassword,
      phoneNumber: body.phoneNumber,
      country: body.country,
      isOnboardingCompleted: true
    });

    return {
      success: true,
      message: 'Perfil completado correctamente',
      user: new UserEntity(updatedUser)
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('edit-phone-number')
  async editPhoneNumber(@CurrentUser() user: JwtUser, @Body() body: EditPhoneNumberDto) {
    const updatedUser = await this.usersService.update(user.userId, {
      phoneNumber: body.phoneNumber,
    });
    return {
      success: true,
      message: 'Número de teléfono actualizado correctamente',
      phoneNumber: updatedUser.phoneNumber
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('edit-password')
  async editPassword(@CurrentUser() user: JwtUser, @Body() body: EditPasswordDto) {
    const validUser = await this.authService.validateUser(
      user.email,
      body.oldPassword,
    );
    if (!validUser) {
      throw new BadRequestException('Contraseña actual incorrecta');
    }
    await this.usersService.update(user.userId, {
      password: await bcrypt.hash(body.newPassword, 10),
    });
    return {
      success: true,
      message: 'Contraseña actualizada correctamente',
    };
  }
}