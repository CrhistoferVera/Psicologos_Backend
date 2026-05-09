import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { EditPackageDto } from './dto/edit-package.dto';

@Injectable()
export class PackageService {
    constructor(
        private prisma: PrismaService,
        private systemConfig: SystemConfigService,
    ) {}

    // CREAR UN PAQUETE UNICO
    async create(createPackageDto: CreatePackageDto) {
        const existingPackage = await this.prisma.package.findFirst({
            where: { name: createPackageDto.name },
        });

        if (existingPackage) {
            throw new ConflictException('Este nombre de paquete ya está registrado');
        }

        return this.prisma.package.create({
            data: createPackageDto,
        });
    }
    //

    async findOne(id: string) {
        const [pkg, config] = await Promise.all([
            this.prisma.package.findUnique({ where: { id } }),
            this.systemConfig.getRuntimeConfig(),
        ]);

        if (!pkg) {
            throw new NotFoundException(`No se encontró el paquete con ID: ${id}`);
        }

        const usdRate = config.usdExchangeRate > 0 ? config.usdExchangeRate : 7;

        return {
            ...pkg,
            price: Number(pkg.price),
            priceUsd: Math.round((Number(pkg.price) / usdRate) * 100) / 100,
        };
    }

    //
    async findAll() {
        const [packages, config] = await Promise.all([
            this.prisma.package.findMany({ where: { isActive: true } }),
            this.systemConfig.getRuntimeConfig(),
        ]);

        const usdRate = config.usdExchangeRate > 0 ? config.usdExchangeRate : 7;

        return packages.map((pkg) => ({
            ...pkg,
            price: Number(pkg.price),
            priceUsd: Math.round((Number(pkg.price) / usdRate) * 100) / 100,
        }));
    }

    // EDITAR UN PAQUETE
    async update(id: string, editPackageDto: EditPackageDto) {
        // 1. Verificar si el paquete existe
        const pkg = await this.prisma.package.findUnique({
            where: { id },
        });

        if (!pkg) {
            throw new NotFoundException(`El paquete con ID ${id} no existe`);
        }

        // 2. Si se intenta cambiar el nombre, verificar que el nuevo no esté duplicado
        if (editPackageDto.name && editPackageDto.name !== pkg.name) {
            const nameExists = await this.prisma.package.findFirst({
                where: { name: editPackageDto.name },
            });
            if (nameExists) {
                throw new ConflictException('El nuevo nombre ya está en uso por otro paquete');
            }
        }

        // 3. Realizar la actualización en TablePlus
        return this.prisma.package.update({
            where: { id },
            data: editPackageDto,
        });
    }

    // ELIMINAR UN PAQUETE (SOFT DELETE)
    async remove(id: string) {
        const pkg = await this.prisma.package.findUnique({
            where: { id },
        });

        if (!pkg) {
            throw new NotFoundException(`No se puede eliminar: El paquete con ID ${id} no existe`);
        }

        return this.prisma.package.delete({
            where: { id },
        });
    }
}