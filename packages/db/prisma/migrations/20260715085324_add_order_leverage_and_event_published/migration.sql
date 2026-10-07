-- Existing rows predate the eventPublished tracking column added here; they
-- already reached the "orders" stream via the (unguarded, pre-fix) XADD call,
-- so backfill them as published. Defaulting them to `false` would make the
-- new reconciliation sweep re-publish all of them into the live matching
-- engine on first run, which is not safe for orders that already matched.
ALTER TABLE "Order" ADD COLUMN     "eventPublished" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ALTER COLUMN "eventPublished" SET DEFAULT false;

-- leverage was never persisted before this migration, so there's no real
-- value to backfill with; 5 matches the frontend's default leverage
-- (apps/web/src/components/OrderForm.tsx) and is only a display/reconciliation
-- placeholder for pre-existing rows, not a correctness-critical value (those
-- orders have already settled).
ALTER TABLE "Order" ADD COLUMN     "leverage" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Order" ALTER COLUMN "leverage" DROP DEFAULT;
