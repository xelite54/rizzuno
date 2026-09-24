# Paid billing launch gate

`lib/billingMode.ts` currently rejects every mode except `free_test`. This checklist is preparation only; it does not activate paid terms, Stripe checkout, renewal, or charging.

Before adding a paid mode, the operator and legal reviewer must approve and publish release-specific terms covering the actual price and currency, billing interval, recurring authorization, renewal timing, cancellation effective date, refund/credit policy, taxes, price-change notice and consent rules, payment-provider or app-store terms, failed payments, entitlement consequences, customer support, and any jurisdiction-specific cooling-off or cancellation rights. Record the reviewed text/version and force reacceptance when material.

Engineering must then implement and test the paid-mode gate, checkout price allowlist, verified webhook state transitions, customer-portal cancellation, refund/chargeback handling, tax configuration, idempotency, privacy export/erasure handling for finance records, and reconciliation. Name Stripe as an active payment processor only in the release where paid processing is enabled. Do not reuse the free-test activation as authorization for a charge.
