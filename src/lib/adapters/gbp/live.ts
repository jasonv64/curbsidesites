import type { GbpNap, GbpSnapshot } from "./types";

/**
 * Live GBP read via the Business Information API. Requires:
 *  - config.location_id  — the numeric location id ("locations/123...")
 *  - secret              — an OAuth 2.0 access token minted from the refresh
 *    token Curbside's GCP project holds for this client's MANAGER grant (D8).
 *    Token plumbing (refresh → access) is a Session 4 runbook item; this
 *    function takes the ready bearer token.
 */
export async function liveGbpSnapshot(config: Record<string, string>, accessToken: string): Promise<GbpSnapshot> {
  const location = config.location_id.startsWith("locations/")
    ? config.location_id
    : `locations/${config.location_id}`;
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${location}?readMask=title,phoneNumbers,storefrontAddress,categories`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`GBP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    title?: string;
    phoneNumbers?: { primaryPhone?: string };
    storefrontAddress?: {
      addressLines?: string[];
      locality?: string;
      administrativeArea?: string;
      postalCode?: string;
    };
    categories?: { primaryCategory?: { displayName?: string }; additionalCategories?: { displayName?: string }[] };
  };
  const nap: GbpNap = {
    name: data.title ?? "",
    phone: data.phoneNumbers?.primaryPhone ?? "",
    street: data.storefrontAddress?.addressLines?.join(" ") ?? "",
    city: data.storefrontAddress?.locality ?? "",
    region: data.storefrontAddress?.administrativeArea ?? "",
    postal: data.storefrontAddress?.postalCode ?? "",
  };
  return {
    available: true,
    nap,
    categories: [
      data.categories?.primaryCategory?.displayName,
      ...(data.categories?.additionalCategories?.map((c) => c.displayName) ?? []),
    ].filter((c): c is string => Boolean(c)),
    source: "live",
  };
}
