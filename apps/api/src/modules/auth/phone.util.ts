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

/**
 * Checkout-only phone formatting for the temporary OTP bypass.
 *
 * This deliberately does not check country metadata, length, or whether the
 * number is assigned. It only keeps a stable, digits-based representation so
 * the value can be recorded and compared within the checkout session.
 */
export function normalizeUnvalidatedPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    throw new BadRequestException('Enter a phone number');
  }

  const compact = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (compact.startsWith('00')) return `+${digits.slice(2)}`;
  return digits;
}

export function maskPhone(phone: string): string {
  const visible = phone.slice(-4);
  const prefix = phone.slice(0, Math.max(2, phone.length - 7));
  return `${prefix} *** ${visible}`;
}
