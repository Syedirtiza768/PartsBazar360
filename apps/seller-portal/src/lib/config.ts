// The seller-portal has no auth/session system yet, so there's no way to
// know "which seller is logged in". Until that exists, default to a real
// seeded seller (rather than a hardcoded fake id like "store-1", which never
// matches any row and silently renders empty tables) so the merchant-facing
// pages actually show data end-to-end. Override via NEXT_PUBLIC_DEMO_SELLER_ID
// if you want to preview a different seller locally.
export const DEMO_SELLER_ID =
  process.env.NEXT_PUBLIC_DEMO_SELLER_ID || 'abd10102-b886-441c-9420-ffa39e174e30'; // "K. Brit Auto Depot - UK"
export const DEMO_SELLER_NAME = 'K. Brit Auto Depot - UK';
