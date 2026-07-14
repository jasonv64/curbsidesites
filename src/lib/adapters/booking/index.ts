import type { TenantBundle } from "@/lib/tenant";
import { integrationFor, selectMode } from "../select";
import { demoAvailability } from "./demo";
import { liveAvailability } from "./live";
import type { BookingAvailability, BookingSlot } from "./types";

export type { BookingAvailability, BookingSlot };

export async function getAvailability(bundle: TenantBundle): Promise<BookingAvailability> {
  const selected = await selectMode({
    tenantSlug: bundle.tenant.slug,
    key: "booking",
    integration: integrationFor(bundle, "booking"),
    fixAt: "src/lib/adapters/booking/live.ts → liveAvailability()",
  });
  return selected.mode === "live"
    ? liveAvailability()
    : demoAvailability(bundle.profile?.hours ?? {});
}
