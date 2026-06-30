import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RefundStatus } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AdminRefundRequestsService } from './admin-refund-requests.service';
import { ResolveRefundDto } from './dto/resolve-refund.dto';

@ApiTags('Admin - Refund Requests')
@Controller('admin/refund-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRefundRequestsController {
  constructor(private readonly service: AdminRefundRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar solicitudes de reembolso' })
  @ApiQuery({ name: 'status', required: false, enum: RefundStatus })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findAll(
    @Query('status') status?: RefundStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(status, Number(page ?? 1), Number(limit ?? 20));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una solicitud de reembolso' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Resolver solicitud: marcar PAID o REJECTED + subir comprobante' })
  @UseInterceptors(FileInterceptor('receipt', { storage: memoryStorage() }))
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveRefundDto,
    @UploadedFile() receipt?: Express.Multer.File,
  ) {
    return this.service.resolve(id, dto, receipt);
  }
}
