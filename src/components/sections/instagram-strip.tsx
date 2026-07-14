import Image from "next/image";
import { getInstagramFeed } from "@/lib/adapters/instagram";
import { TenantImage } from "@/components/tenant-image";
import type { SectionData } from "@/lib/section-data";

/** Recent posts strip — cached rows or branded demo tiles (D11). */
export async function InstagramStrip({
  data,
  props,
}: {
  data: SectionData;
  props: { heading?: string };
}) {
  const feed = await getInstagramFeed(data.bundle);
  if (feed.posts.length === 0) return null;
  const handle = feed.handle?.replace(/^@/, "");

  return (
    <section className="border-y-2 border-edge bg-surface-raised">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-3xl text-ink">
            {props.heading ?? "From the shop floor"}
          </h2>
          {handle ? (
            <a
              href={`https://instagram.com/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-accent underline underline-offset-4"
            >
              @{handle}
            </a>
          ) : null}
        </div>
        <ul className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {feed.posts.slice(0, 6).map((post, i) => (
            <li key={post.id} className="relative aspect-square overflow-hidden border-2 border-edge">
              {post.imageUrl ? (
                <Image
                  src={post.imageUrl}
                  alt={post.caption || "Instagram post"}
                  fill
                  sizes="(min-width: 640px) 16vw, 33vw"
                  className="object-cover"
                />
              ) : (
                <TenantImage
                  images={data.bundle.images}
                  slot={`instagram-demo-${i + 1}`}
                  fill
                  altOverride={post.caption}
                  sizes="(min-width: 640px) 16vw, 33vw"
                />
              )}
            </li>
          ))}
        </ul>
        {feed.isDemo ? (
          <p className="mt-4 text-xs text-ink-muted">
            Sample feed — the live feed activates once Instagram is connected.
          </p>
        ) : null}
      </div>
    </section>
  );
}
