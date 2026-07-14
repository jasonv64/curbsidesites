import { notFound, redirect } from "next/navigation";
import { getTenantBundle } from "@/lib/tenant";
import { getPortalSession } from "@/lib/portal-auth";
import { HoursForm, ServiceForm } from "@/components/portal/portal-forms";

/** Hours + services editing. Writes revalidate this tenant only (Part 4). */
export default async function SettingsPage({ params }: PageProps<"/s/[host]/portal/settings">) {
  const { host } = await params;
  const bundle = await getTenantBundle(decodeURIComponent(host));
  if (!bundle) notFound();
  const session = await getPortalSession(bundle);
  if (!session) redirect("/portal");

  return (
    <div className="space-y-12">
      <section aria-labelledby="hours-h">
        <h2 id="hours-h" className="font-display text-2xl text-ink">Business hours</h2>
        <p className="mt-1 text-sm text-ink-muted">
          24-hour times (08:00, 17:30). Changes go live the moment you save.
        </p>
        <div className="mt-4">
          <HoursForm hours={bundle.profile?.hours ?? {}} />
        </div>
      </section>

      <section aria-labelledby="services-h">
        <h2 id="services-h" className="font-display text-2xl text-ink">Services</h2>
        <ul className="mt-3 max-w-xl divide-y-2 divide-edge border-y-2 border-edge">
          {bundle.services.map((s) => (
            <li key={s.slug} className="flex justify-between gap-3 py-2 text-sm">
              <span className="font-bold text-ink">{s.name}</span>
              <span className="text-ink-muted">/{s.slug}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-muted">
          Add a new service or update an existing one (matching slug updates it). It shows up
          everywhere at once — services page, menus, the quote form, search data.
        </p>
        <div className="mt-4">
          <ServiceForm />
        </div>
      </section>
    </div>
  );
}
