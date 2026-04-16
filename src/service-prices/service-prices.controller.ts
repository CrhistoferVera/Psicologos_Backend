import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ServicePricesService } from './service-prices.service';
import { UpsertServicePriceDto } from './dto/upsert-service-price.dto';

interface JwtUser {
  userId: string;
  role: string;
}

@Controller('service-prices')
export class ServicePricesController {
  constructor(private readonly servicePricesService: ServicePricesService) {}

  // GET /service-prices/public/:userId - precios publicos de cualquier profesional (sin auth)
  @Get('public/:userId')
  getPublicPrices(@Param('userId') userId: string) {
    return this.servicePricesService.getPublicPrices(userId);
  }

  // GET /service-prices - profesional consulta sus precios
  @Get()
  @UseGuards(JwtAuthGuard)
  getMyPrices(@CurrentUser() user: JwtUser) {
    return this.servicePricesService.getMyPrices(user.userId);
  }

  // PUT /service-prices - profesional crea o actualiza un precio
  @Put()
  @UseGuards(JwtAuthGuard)
  upsertPrice(@CurrentUser() user: JwtUser, @Body() dto: UpsertServicePriceDto) {
    return this.servicePricesService.upsertPrice(user.userId, dto);
  }
}
