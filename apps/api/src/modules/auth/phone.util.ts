import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Canonical phone normalization used by checkout identity and account auth. */
export function normalizePhone(phone: string, defaultCountry = 'AE'): string {
  const parsed = parsePhoneNumberFromString(phone, defaultCountry as 'AE');
  if (!parsed || !parsed.isValid()) {
    throw new BadRequestException('Enter a valid mobile number');
  }
  return parsed.number;
}

export function maskPhone(phone: string): string {
  const visible = phone.slice(-4);
  const prefix = phone.slice(0, Math.max(2, phone.length - 7));
  return `${prefix} *** ${visible}`;
}
