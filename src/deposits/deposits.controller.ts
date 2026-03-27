import {
    Controller,
    Post,
    Body,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
    UseGuards,
    BadRequestException,
    Logger
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { DepositsService } from './deposits.service';
import { CreateDepositRequestDto } from './dto/create-depositRequest.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Deposits')
@Controller('deposits')
@UseGuards(JwtAuthGuard) // Protegemos el endpoint, solo usuarios autenticados

export class DepositsController {

    private readonly logger = new Logger(DepositsController.name);

    constructor(private readonly depositsService: DepositsService) { }

    @Post('request')
    @ApiOperation({ summary: 'Crear una solicitud de depósito para compra de paquete' })
    @ApiConsumes('multipart/form-data') // Necesario para Swagger al subir archivos
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                packageId: { type: 'string', example: 'uuid-del-paquete' },
                paymentMethodId: { type: 'string', example: 'uuid-del-metodo' },
                file: {
                    type: 'string',
                    format: 'binary',
                    description: 'Imagen del comprobante (PNG, JPG, JPEG, PDF)',
                },
            },
        },
    })

    @UseInterceptors(FileInterceptor('file'))
    async createDeposit(
        @CurrentUser() user: any, //cuando es objeto
        @Body() createDepositDto: CreateDepositRequestDto,
        @UploadedFile() file: Express.Multer.File,
    ) {

        const userId = user?.userId || user?.id || user?.sub;

        this.logger.log(`📥 POST /deposits/request - userId: ${userId}`);
        this.logger.debug(`DTO → ${JSON.stringify(createDepositDto)}`);

        if (!userId) {
            this.logger.error('❌ No se pudo obtener el userId del token. Revisa JwtStrategy.');
            throw new BadRequestException('Usuario no identificado en el sistema.');
        }

        if (!file) {
            this.logger.warn(`⚠️ Usuario ${userId} no envió comprobante`);
            throw new BadRequestException('Debe subir un comprobante de pago');
        }


        try {
            const result = await this.depositsService.createDepositRequest(userId, createDepositDto, file);

            this.logger.log(`✅ Depósito creado correctamente para usuario ${userId}`);
            return result;

        } catch (error) {
            this.logger.error(`❌ Error creando depósito: ${error.message}`);
            throw error;
        }
    }
}