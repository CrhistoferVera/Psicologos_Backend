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
  Patch,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserEntity } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { EditPhoneNumberDto } from './dto/edit-phone-number.dto';
import { EditPasswordDto } from './dto/edit-password.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import * as bcrypt from 'bcrypt';
import { SystemConfigService } from '../system-config/system-config.service';

interface JwtUser {
  userId: string;
  phoneNumber: string;
  email: string | null;
  role: UserRole;
  isProfileComplete: boolean;
}

@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  @Get('config')
  getConfig() {
    return this.systemConfigService.getPublicConfig();
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: JwtUser) {
    const found = await this.usersService.findOneById(user.userId);
    if (!found) throw new NotFoundException('Usuario no encontrado');
    return new UserEntity(found);
  }

  @UseGuards(JwtAuthGuard)
  @Get('expense-history')
  async getExpenseHistory(@CurrentUser() user: JwtUser) {
    try {
      const expenseHistory = await this.usersService.findUserExpenseHistory(user.userId);

      return {
        success: true,
        data: expenseHistory,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener el historial de gastos',
        data: [],
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('payment-methods')
  async getMethods() {
    return await this.usersService.findAllActive();
  }

  @UseGuards(JwtAuthGuard)
  @Get('my/profile')
  async getMyProfileData(@CurrentUser() user: JwtUser) {
    const profile = await this.usersService.getUserFullProfile(user.userId);

    return new UserEntity(profile);
  }

  @UseGuards(JwtAuthGuard)
  @Get('wallet')
  async getMyWallet(@CurrentUser() user: JwtUser) {
    const wallet = await this.usersService.findWalletByUserId(user.userId);

    if (!wallet) {
      throw new NotFoundException('billetera no encontrada');
    }

    return {
      success: true,
      balance: Number(wallet.balance),
      promotionalBalance: Number(wallet.promotionalBalance ?? 0),
      realBalance: Number(wallet.balance) - Number(wallet.promotionalBalance ?? 0),
      userId: wallet.userId,
      updatedAt: wallet.updatedAt,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('fcm-token')
  async updateFcmToken(
    @CurrentUser() user: JwtUser,
    @Body() body: UpdateFcmTokenDto,
  ) {
    await this.usersService.updateFcmToken(user.userId, body.fcmToken);
    return { success: true };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserEntity> {
    const user = await this.usersService.findOneById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return new UserEntity(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('edit-phone-number')
  async editPhoneNumber(
    @CurrentUser() user: JwtUser,
    @Body() body: EditPhoneNumberDto,
  ) {
    const updated = await this.usersService.update(user.userId, {
      phoneNumber: body.phoneNumber,
    });
    return {
      success: true,
      message: 'Numero de telefono actualizado correctamente',
      phoneNumber: updated.phoneNumber,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('edit-password')
  async editPassword(
    @CurrentUser() user: JwtUser,
    @Body() body: EditPasswordDto,
  ) {
    const dbUser = await this.usersService.findOneById(user.userId);
    if (!dbUser?.password) {
      throw new BadRequestException('No tienes contrasena configurada');
    }

    const isValid = await bcrypt.compare(body.oldPassword, dbUser.password);
    if (!isValid) {
      throw new BadRequestException('Contrasena actual incorrecta');
    }

    await this.usersService.update(user.userId, {
      password: await bcrypt.hash(body.newPassword, 10),
    });

    return { success: true, message: 'Contrasena actualizada correctamente' };
  }
}
