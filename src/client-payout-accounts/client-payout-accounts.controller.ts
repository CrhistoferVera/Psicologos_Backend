import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientPayoutAccountsService } from './client-payout-accounts.service';
import { CreatePayoutAccountDto } from './dto/create-payout-account.dto';

interface JwtUser {
  userId: string;
  role: string;
}

@ApiTags('Client Payout Accounts')
@Controller('client/payout-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER)
export class ClientPayoutAccountsController {
  constructor(private readonly service: ClientPayoutAccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Guardar cuenta bancaria o crypto para recibir reembolsos' })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePayoutAccountDto) {
    return this.service.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar mis cuentas de pago guardadas' })
  findAll(@CurrentUser() user: JwtUser) {
    return this.service.findAllByClient(user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una cuenta de pago' })
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.service.remove(user.userId, id);
  }
}
