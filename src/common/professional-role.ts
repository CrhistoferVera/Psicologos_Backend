import { UserRole } from '@prisma/client';

// Internal canonical role for professionals.
export const PROFESSIONAL_ROLE = UserRole.PROFESSIONAL;

// Compatibility set to read legacy rows/tokens while migration completes.
export const PROFESSIONAL_ROLES: UserRole[] = [UserRole.PROFESSIONAL, UserRole.ANFITRIONA];
