import { createHash } from 'node:crypto';

export const CHECKOUT_VALIDATION_POLICY_VERSION = 'buyer-checkout-2026-10-09.1';
export const CHECKOUT_VALIDATION_TTL_MS = 10 * 60 * 1000;

export type CheckoutFitmentStatus =
  'CONFIRMED' | 'UNVERIFIED' | 'NO_VEHICLE' | 'CONFLICT';

export interface CheckoutLineDecision {
  cartItemId: string;
  partId: string;
  offerId: string;
  quantity: number;
  intendedVehicleConfigId: string | null;
  purchaseIntent: string;
  fitmentStatus: CheckoutFitmentStatus;
  fitmentId: string | null;
  evidenceLevel: string | null;
  confidence: number | null;
  source: string | null;
  verificationStatus: string | null;
  shippingStatus: 'AVAILABLE' | 'BLOCKED' | 'REQUIRES_QUOTE' | 'NEEDS_REVIEW';
  shippingReason: string | null;
  blockingReason: string | null;
}

export function checkoutValidationFingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** The acknowledgment list must exactly match current server-computed needs. */
export function acknowledgmentsMatch(
  requiredIds: string[],
  submittedIds: string[],
): boolean {
  if (
    new Set(requiredIds).size !== requiredIds.length ||
    new Set(submittedIds).size !== submittedIds.length
  ) {
    return false;
  }
  const required = [...requiredIds].sort();
  const submitted = [...submittedIds].sort();
  return (
    required.length === submitted.length &&
    required.every((id, index) => id === submitted[index])
  );
}

export function publicCheckoutValidation(snapshot: any) {
  return {
    validationId: snapshot.validationId,
    fingerprint: snapshot.fingerprint,
    policyVersion: snapshot.policyVersion,
    expiresAt: snapshot.expiresAt,
    canPay:
      snapshot.blockingLineIds.length === 0 &&
      snapshot.requiredAcknowledgmentCartItemIds.length === 0,
    destinationCountry: snapshot.destinationCountry,
    shippingAvailable: snapshot.shippingAvailable,
    lines: snapshot.lines.map((line: CheckoutLineDecision) => ({
      cartItemId: line.cartItemId,
      quantity: line.quantity,
      intendedVehicleConfigId: line.intendedVehicleConfigId,
      fitmentStatus: line.fitmentStatus,
      requiresAcknowledgment:
        line.fitmentStatus === 'UNVERIFIED' ||
        line.fitmentStatus === 'NO_VEHICLE',
      shippingStatus: line.shippingStatus,
      shippingReason: line.shippingReason,
      blockingReason: line.blockingReason,
    })),
    requiredAcknowledgmentCartItemIds:
      snapshot.requiredAcknowledgmentCartItemIds,
    blockingLineIds: snapshot.blockingLineIds,
  };
}
