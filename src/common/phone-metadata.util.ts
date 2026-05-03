import { BadRequestException } from '@nestjs/common';
import { PHONE_COUNTRIES, PhoneCountry } from './phone-countries';

export const BILLING_REGION_BOLIVIA = 'BOLIVIA';
export const BILLING_REGION_INTERNATIONAL = 'INTERNATIONAL';
export const CURRENCY_BOB = 'BOB';
export const CURRENCY_USD = 'USD';

export type NormalizedPhoneMetadata = {
  phoneNumber: string;
  phoneDialCode: string;
  phoneNationalNumber: string;
  phoneCountryIso: string;
  phoneCountryName: string;
  billingRegion: string;
  preferredCurrency: string;
};

export function normalizePhoneDialCode(value: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) throw new BadRequestException('El codigo telefonico es obligatorio');
  return `+${digits}`;
}

export function normalizePhoneCountryIso(value: string): string {
  const iso = (value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) {
    throw new BadRequestException('El pais telefonico es invalido');
  }
  return iso;
}

export function normalizePhoneNationalNumber(value: string): string {
  const normalized = (value ?? '').replace(/\D/g, '');
  if (normalized.length < 6 || normalized.length > 15) {
    throw new BadRequestException('Numero de telefono invalido');
  }
  return normalized;
}

function findPhoneCountry(phoneCountryIso: string, phoneDialCode: string): PhoneCountry {
  const country = PHONE_COUNTRIES.find(
    (item) => item.iso === phoneCountryIso && item.dialCode === phoneDialCode,
  );
  if (!country) {
    throw new BadRequestException('El pais y codigo telefonico no coinciden');
  }
  return country;
}

export function deriveBillingFields(phoneCountryIso: string) {
  const isBolivia = phoneCountryIso === 'BO';
  return {
    billingRegion: isBolivia ? BILLING_REGION_BOLIVIA : BILLING_REGION_INTERNATIONAL,
    preferredCurrency: isBolivia ? CURRENCY_BOB : CURRENCY_USD,
  };
}

export function normalizePhoneRegistrationInput(input: {
  phoneDialCode: string;
  phoneNationalNumber: string;
  phoneCountryIso: string;
  phoneCountryName?: string;
}): NormalizedPhoneMetadata {
  const phoneDialCode = normalizePhoneDialCode(input.phoneDialCode);
  const phoneNationalNumber = normalizePhoneNationalNumber(input.phoneNationalNumber);
  const phoneCountryIso = normalizePhoneCountryIso(input.phoneCountryIso);
  const country = findPhoneCountry(phoneCountryIso, phoneDialCode);
  const phoneCountryName = country.name;
  const phoneNumber = `${phoneDialCode}${phoneNationalNumber}`;
  const { billingRegion, preferredCurrency } = deriveBillingFields(phoneCountryIso);

  return {
    phoneNumber,
    phoneDialCode,
    phoneNationalNumber,
    phoneCountryIso,
    phoneCountryName,
    billingRegion,
    preferredCurrency,
  };
}
