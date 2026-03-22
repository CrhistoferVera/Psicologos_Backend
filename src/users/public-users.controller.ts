import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Request,
    UnauthorizedException,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';
import { ToggleSavedAnfitrianaDto } from './dto/toggle-saved-anfitriona.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface JwtUser {
    userId: string;
    role: UserRole;
}

@ApiTags('Usuarios - Interacción')
@Controller('users/public')
export class PublicUsersController {
    constructor(private readonly usersService: UsersService) { }

    // TOGGLE GUARDAR / QUITAR ANFITRIONA
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.USER)
    @Post('saved-anfitrionas/toggle')
    @ApiOperation({ summary: 'Guardar o quitar anfitriona de favoritos' })
    async toggleSaved(
        @CurrentUser() user: JwtUser,
        @Body() body: ToggleSavedAnfitrianaDto,
    ) {
        return this.usersService.toggleSavedAnfitriona(user.userId, body.anfitrionaId);
    }

    // LISTAR ANFITRIONAS GUARDADAS
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.USER)
    @Get('saved-anfitrionas')
    @ApiOperation({ summary: 'Listar anfitrionas guardadas del cliente' })
    @ApiQuery({ name: 'cursor', required: false, description: 'ID del último registro recibido' })
    @ApiQuery({ name: 'limit', required: false, example: 10 })
    async getSaved(
        @CurrentUser() user: JwtUser,
        @Query('cursor') cursor?: string,
        @Query('limit') limit: number = 10,
    ) {
        return this.usersService.getSavedAnfitrionas(user.userId, cursor, Number(limit));
    }
}