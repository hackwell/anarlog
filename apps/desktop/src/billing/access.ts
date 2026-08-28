// Session Echo has no accounts and no subscriptions, so every install runs on
// the free tier. Kept as a hook so the entitlement checks that read it stay
// call-site compatible.
export type BillingAccess = {
  isPaid: boolean;
  isPro: boolean;
};

const FREE_TIER: BillingAccess = Object.freeze({
  isPaid: false,
  isPro: false,
});

export function useBillingAccess(): BillingAccess {
  return FREE_TIER;
}
