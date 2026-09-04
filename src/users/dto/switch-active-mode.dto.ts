import { IsIn } from 'class-validator';
import { UserRole } from '@prisma/client';

// El toggle del perfil solo alterna entre estos dos modos.
export class SwitchActiveModeDto {
  @IsIn([UserRole.USER, UserRole.PROFESSIONAL], {
    message: 'El modo debe ser USER o PROFESSIONAL.',
  })
  mode: 'USER' | 'PROFESSIONAL';
}
