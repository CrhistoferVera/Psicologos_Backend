import { Controller, Get, Patch, Param, Body, Query } from '@nestjs/common';
import { AnfitrionaService } from './anfitriona.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UpdateAnfitrionaDto } from './dto/update-anfitriona.dto';

@ApiTags('Admin - Anfitrionas') // Cambiado para organizar mejor tu Swagger
@Controller('admin/anfitrionas') // Ruta profesional para el panel de administración
export class AnfitrionaController {
    constructor(private readonly clientService: AnfitrionaService) { }

    /**
  * LISTAR TODOS LAS SOLICITUDEES DE PAGO (USUARIOS ROL ANFITRIONA)
  */
    @Get('list/withdrawal-requests')
    @ApiOperation({ summary: 'Listar solicitudes de retiro de anfitrionas' })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'cursor', required: false, description: 'ID del último registro recibido' })
    findAllWithdrawalRequests(
        @Query('search') search?: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit: number = 10,
    ) {
        console.log('✅ HIT withdrawal-requests | search:', search, '| cursor:', cursor, '| limit:', limit);
        return this.clientService.findAllWithdrawalRequest(
            search,
            cursor,
            Number(limit),
        );
    }

    // HISTORIAL DE PAGOS A ANFITRIONA (RECHAZADO Y APROBADO)
    @Get('payment/history')
    @ApiOperation({ summary: 'historial de pagos a anfitriona' })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'cursor', required: false, description: 'ID del último registro recibido' })
    findWithdrawalRequestHistory(
        @Query('search') search?: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit: number = 10,
    ) {
        return this.clientService.findWithdrawalRequestHistory(
            search,
            cursor,
            Number(limit),
        );
    }

    //CANTIDAD DE SOLICITUDES DE PAGOS PENDIENTES
    @Get('count/pending-withdrawal-requests')
    @ApiOperation({ summary: 'Obtener cantidad de solicitudes de retiro pendientes' })
    countPendingWithdrawalRequests() {
        return this.clientService.countPendingRequests();
    }

    /**
     * LISTAR TODOS LAS ANFITRIONA (USUARIOS ROL ANFITRIONA)
     */
    @Get()
    @ApiOperation({ summary: 'Listar anfitrionas o buscar por nombre, email o teléfono' })

    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'cursor', required: false, description: 'ID del último registro recibido' })
    @ApiQuery({ name: 'limit', required: false, example: 10 })

    findAll(
        @Query('search') search?: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit: number = 10,
    ) {
        return this.clientService.findAll(
            search,
            cursor,
            Number(limit),
        );
    }

    /**
     * OBTENER DETALLES DE UN ANFITRIONA ESPECÍFICO
     */
    @Get(':id')
    @ApiOperation({ summary: 'Obtener información detallada de una anfitriona' })
    findOne(@Param('id') id: string) {
        return this.clientService.findOne(id);
    }

    /**
     * ACTIVAR O SUSPENDER UNA ANFITRIONA
     */
    @Patch(':id/status')
    @ApiOperation({ summary: 'Cambiar estado de la anfitriona (Activo/Suspendido)' })
    updateStatus(
        @Param('id') id: string,
        @Body() updateAnfitrionaStatusDto: UpdateAnfitrionaDto
    ) {
        return this.clientService.updateStatus(id, updateAnfitrionaStatusDto);
    }
}