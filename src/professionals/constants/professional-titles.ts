export const PROFESSIONAL_TITLES = ['Dr.', 'Dra.', 'Lic.', 'Lic.ª', 'Mg.', 'MsC.', 'PhD'] as const;
export type ProfessionalTitle = (typeof PROFESSIONAL_TITLES)[number];
