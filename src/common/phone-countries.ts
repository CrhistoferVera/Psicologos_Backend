export type PhoneCountry = {
  iso: string;
  dialCode: string;
  name: string;
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: 'BO', dialCode: '+591', name: 'Bolivia' },
  { iso: 'AR', dialCode: '+54', name: 'Argentina' },
  { iso: 'BR', dialCode: '+55', name: 'Brasil' },
  { iso: 'CL', dialCode: '+56', name: 'Chile' },
  { iso: 'CO', dialCode: '+57', name: 'Colombia' },
  { iso: 'CR', dialCode: '+506', name: 'Costa Rica' },
  { iso: 'DO', dialCode: '+1', name: 'Republica Dominicana' },
  { iso: 'EC', dialCode: '+593', name: 'Ecuador' },
  { iso: 'SV', dialCode: '+503', name: 'El Salvador' },
  { iso: 'GT', dialCode: '+502', name: 'Guatemala' },
  { iso: 'HN', dialCode: '+504', name: 'Honduras' },
  { iso: 'NI', dialCode: '+505', name: 'Nicaragua' },
  { iso: 'PA', dialCode: '+507', name: 'Panama' },
  { iso: 'PE', dialCode: '+51', name: 'Peru' },
  { iso: 'PY', dialCode: '+595', name: 'Paraguay' },
  { iso: 'UY', dialCode: '+598', name: 'Uruguay' },
  { iso: 'VE', dialCode: '+58', name: 'Venezuela' },
  { iso: 'MX', dialCode: '+52', name: 'Mexico' },
  { iso: 'US', dialCode: '+1', name: 'Estados Unidos' },
  { iso: 'CA', dialCode: '+1', name: 'Canada' },
  { iso: 'ES', dialCode: '+34', name: 'Espana' },
];
