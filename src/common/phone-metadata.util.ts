export const BILLING_REGION_BOLIVIA = 'BOLIVIA';
export const BILLING_REGION_INTERNATIONAL = 'INTERNATIONAL';
export const CURRENCY_BOB = 'BOB';
export const CURRENCY_USD = 'USD';

/**
 * Deriva la region de facturacion y la moneda a partir del ISO del pais
 * seleccionado por el usuario (ej. "BO"). Bolivia usa BOB; el resto USD.
 */
export function deriveBillingFields(countryIso: string) {
  const iso = (countryIso ?? '').trim().toUpperCase();
  const isBolivia = iso === 'BO';
  return {
    billingRegion: isBolivia ? BILLING_REGION_BOLIVIA : BILLING_REGION_INTERNATIONAL,
    preferredCurrency: isBolivia ? CURRENCY_BOB : CURRENCY_USD,
  };
}
