import Image from "next/image";
import type { ImageRow } from "@/lib/schemas";
import { parseAspect } from "@/lib/placeholder";

/**
 * Every content image renders through this. Real URL → next/image through
 * the optimizer. No URL yet → the tenant's branded SVG placeholder at the
 * slot's aspect ratio (Part 10: zero uploaded images must still look
 * finished, and nothing may ever 404).
 */
export function findImage(images: ImageRow[], slot: string): ImageRow | null {
  return images.find((i) => i.slot_id === slot) ?? null;
}

export function TenantImage({
  images,
  slot,
  className,
  sizes,
  priority,
  fill,
  altOverride,
}: {
  images: ImageRow[];
  slot: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Cover a positioned parent (hero backgrounds, gallery tiles). */
  fill?: boolean;
  altOverride?: string;
}) {
  const row = findImage(images, slot);
  const aspect = parseAspect(row?.aspect ?? "16:9");
  const alt = altOverride ?? row?.alt ?? "";

  if (row?.url) {
    if (fill) {
      return (
        <Image
          src={row.url}
          alt={alt}
          fill
          sizes={sizes ?? "100vw"}
          priority={priority}
          className={`object-cover ${className ?? ""}`}
        />
      );
    }
    return (
      <Image
        src={row.url}
        alt={alt}
        width={1600}
        height={Math.round((1600 * aspect.h) / aspect.w)}
        sizes={sizes ?? "(min-width: 1024px) 50vw, 100vw"}
        priority={priority}
        className={className}
      />
    );
  }

  // Placeholder: plain <img> (SVG route, no optimizer round-trip), correct
  // intrinsic dimensions so there is zero CLS.
  const src = `/placeholder/${encodeURIComponent(slot)}`;
  if (fill) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover ${className ?? ""}`}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={1600}
      height={Math.round((1600 * aspect.h) / aspect.w)}
      className={className}
    />
  );
}
