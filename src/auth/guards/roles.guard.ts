import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { hasRequiredRole, JwtUser } from '../../common/capabilities';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const capabilities = user?.capabilities;

    if (!capabilities) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    // El endpoint acepta al usuario si posee ALGUNA de las capacidades requeridas.
    const allowed = requiredRoles.some((role) => hasRequiredRole(capabilities, role));

    if (!allowed) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }

    return true;
  }
}
