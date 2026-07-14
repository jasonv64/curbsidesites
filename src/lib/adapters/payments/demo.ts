import type { TenantBundle } from "@/lib/tenant";
import type { PaymentsPresentation } from "./types";

export function demoPayments(bundle: TenantBundle): PaymentsPresentation {
  const nap = bundle.profile?.nap;
  return {
    kind: "demo_callout",
    message: "Online payments aren't live yet — call the shop and we'll take care of it over the phone.",
    phoneDisplay: nap?.phone_display ?? null,
    phoneTel: nap?.phone_tel ?? null,
  };
}
