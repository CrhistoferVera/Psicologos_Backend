import { UserRole } from '@prisma/client';

// Capacidades derivadas de una cuenta. A diferencia de "role" (un solo valor),
// una misma cuenta puede tener varias capacidades a la vez (usuario y profesional),
// estilo inDrive. Los permisos se basan en capacidades, NO en el modo activo.
export interface UserCapabilities {
  // Puede comprar/recargar/reservar/pagar (todos los no-admin).
  isClient: boolean;
  // Puede operar el lado profesional (tiene un ProfessionalProfile).
  isProfessional: boolean;
  // Administrador de la plataforma.
  isAdmin: boolean;
}

// Forma del objeto que queda en req.user tras validar el JWT.
export interface JwtUser {
  userId: string;
  phoneNumber: string | null;
  email: string | null;
  role: UserRole;
  // Modo seleccionado en la UI (el toggle del perfil). No otorga permisos.
  activeMode: UserRole;
  isProfileComplete: boolean;
  capabilities: UserCapabilities;
}

// Deriva las capacidades desde el rol legacy + la existencia de perfil profesional.
export function computeCapabilities(input: {
  role: UserRole;
  hasProfessionalProfile: boolean;
}): UserCapabilities {
  const isAdmin = input.role === UserRole.ADMIN;
  return {
    isAdmin,
    // Todos los no-admin son clientes (pueden comprar/reservar/pagar).
    isClient: !isAdmin,
    // La capacidad profesional se deriva de tener un ProfessionalProfile.
    isProfessional: input.hasProfessionalProfile,
  };
}

// Traduce un rol requerido por un endpoint (@Roles(...)) a la capacidad equivalente.
// ANFITRIONA se trata como profesional por compatibilidad legacy.
export function hasRequiredRole(caps: UserCapabilities, required: UserRole): boolean {
  switch (required) {
    case UserRole.ADMIN:
      return caps.isAdmin;
    case UserRole.PROFESSIONAL:
    case UserRole.ANFITRIONA:
      return caps.isProfessional;
    case UserRole.USER:
      return caps.isClient;
    default:
      return false;
  }
}
