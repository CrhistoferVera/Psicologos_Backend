import { UserRole } from '@prisma/client';

// Transitional mapping: DB enum is still ANFITRIONA, domain contract is PROFESSIONAL.
export const PROFESSIONAL_ROLE = UserRole.ANFITRIONA;
