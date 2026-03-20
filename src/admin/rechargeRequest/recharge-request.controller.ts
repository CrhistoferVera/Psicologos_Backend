import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RechargeRequestService } from './recharge-request.service';
import { UpdateDepositStatusDto } from './dto/update-depositsRequest.dto';
import { Logger, UseGuards } from '@nestjs/common';
import { DepositStatus } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { MailService } from 'src/mail/mail.service';

@ApiTags('Admin - deposits') // Cambiado para organizar mejor tu Swagger
@Controller('admin/deposits') // Ruta profesional para el panel de administración
export class RechargeRequestController {

    private readonly logger = new Logger(RechargeRequestController.name);

    constructor(
        private readonly mailService: MailService,
        private readonly rechargeRequestService: RechargeRequestService) { }

    /**
     * LISTAR TODAS LAS SOLICITUDES DE RECARGA
     */
    @Get()
    @ApiOperation({ summary: 'Listar solicitudes de recarga (paginacion por cursor)' })

    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'cursor', required: false, description: 'ID del último registro recibido' })
    @ApiQuery({ name: 'limit', required: false, example: 10 })

    async findAll(
        @Query('search') search?: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit: number = 10,
    ) {

        this.logger.log(`📥 GET /admin/deposits`);
        this.logger.debug(`Query params → search: ${search}, cursor: ${cursor}, limit: ${limit}`);

        const result = await this.rechargeRequestService.getAllRechargeRequests(
            search,
            cursor,
            Number(limit),
        );

        this.logger.log(`📤 Respuesta enviada - registros: ${result.requests.length}`);

        return result;
    }

    /**
     * APROBAR / RECHAZAR DEPOSITO
     */
    @UseGuards(JwtAuthGuard, RolesGuard)//JwtAuthGuard: valida que el usuario este logeado
    @Roles('ADMIN') //RolesGuard: valida que el usuario tenga el rol de administrador
    @Patch(':id/status')
    @ApiOperation({ summary: 'Aprobar o rechazar una solicitud de recarga' })
    async updateStatus(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() updateDto: UpdateDepositStatusDto,
    ) {
        this.logger.log(`📥 PATCH /admin/deposits/${id}/status`);
        this.logger.debug(`Body → ${JSON.stringify(updateDto)}`);

        try {
            const result = await this.rechargeRequestService.updateDepositStatus(id, updateDto);

            this.logger.log(`✅ Solicitud ${id} procesada correctamente`);
            this.logger.debug(`Resultado → ${JSON.stringify(result)}`);

            return result;

        } catch (error) {

            this.logger.error(
                `❌ Error al procesar solicitud ${id}`,
                error.stack
            );

            throw error;
        }
    }


   // Endpoint de prueba para RECHAZO
    @Get('test-email-rejected')
    async testRejected() {
        await this.mailService.sendDepositStatusNotification(
            'paredespavajhoel@gmail.com',
            'Tester Reject',
            'REJECTED',
            0, 
            'El comprobante de pago no es legible o está alterado.' 
        );
        return { message: 'Correo de rechazo enviado, revisa tu bandeja' };
    }

}