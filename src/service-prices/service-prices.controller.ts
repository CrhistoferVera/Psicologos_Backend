import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ServicePricesService } from './service-prices.service';
import { UpsertServicePriceDto } from './dto/upsert-service-price.dto';

interface JwtUser {
  userId: string;
  role: string;
}

@UseGuards(JwtAuthGuard)
@Controller('service-prices')
export class ServicePricesController {
  constructor(private readonly servicePricesService: ServicePricesService) {}

  // GET /service-prices — anfitriona consulta sus precios
  @Get()
  getMyPrices(@CurrentUser() user: JwtUser) {
    return this.servicePricesService.getMyPrices(user.userId);
  }

  // PUT /service-prices — anfitriona crea o actualiza un precio
  @Put()
  upsertPrice(@CurrentUser() user: JwtUser, @Body() dto: UpsertServicePriceDto) {
    return this.servicePricesService.upsertPrice(user.userId, dto);
  }
}
