import { notFound } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getDisplayNumber } from "@/lib/adapters/call-tracking";
import { RenderSections } from "@/lib/section-registry";

/** Home. Entirely section-composed from the tenant's sections rows (Part 5). */
export default async function HomePage({ params }: PageProps<"/s/[host]">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const displayNumber = await getDisplayNumber(bundle);
  return <RenderSections data={{ bundle, displayNumber }} page="home" />;
}
