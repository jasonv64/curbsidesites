"use client";

/** Client-side portal forms, all driven by useActionState over server actions. */
import { useActionState } from "react";
import {
  requestLogin,
  savePost,
  saveHours,
  saveService,
  type LoginState,
  type ContentSaveState,
  type SettingsState,
} from "@/app/s/[host]/portal/actions";
import type { ContentRow, Hours } from "@/lib/schemas";
import { DAY_KEYS } from "@/lib/schemas";

const inputCls =
  "w-full border-2 border-edge bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-accent";
const labelCls = "mb-1 block text-sm font-bold text-ink";
const buttonCls =
  "bg-accent px-6 py-2.5 font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50";

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLogin, {
    status: "idle",
    message: "",
  } as LoginState);
  return (
    <form action={action} className="max-w-md">
      <label htmlFor="pl-email" className={labelCls}>
        Owner email
      </label>
      <input id="pl-email" name="email" type="email" required autoComplete="email" className={inputCls} />
      <button type="submit" disabled={pending} className={`mt-3 ${buttonCls}`}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p aria-live="polite" className="mt-3 text-sm text-ink-muted">
        {state.message}
      </p>
    </form>
  );
}

const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export function HoursForm({ hours }: { hours: Hours }) {
  const [state, action, pending] = useActionState(saveHours, {
    status: "idle",
    message: "",
  } as SettingsState);
  return (
    <form action={action} className="max-w-xl">
      <div className="divide-y-2 divide-edge border-2 border-edge">
        {DAY_KEYS.map((day) => {
          const ranges = hours[day] ?? [];
          const closed = ranges.length === 0;
          return (
            <fieldset key={day} className="grid grid-cols-[6rem_1fr_1fr_auto] items-center gap-3 p-3">
              <legend className="sr-only">{DAY_LABELS[day]} hours</legend>
              <span className="text-sm font-bold text-ink">{DAY_LABELS[day]}</span>
              <div>
                <label htmlFor={`${day}_open`} className="sr-only">{DAY_LABELS[day]} opening time</label>
                <input id={`${day}_open`} name={`${day}_open`} defaultValue={ranges[0]?.[0] ?? ""} placeholder="08:00" className={inputCls} />
              </div>
              <div>
                <label htmlFor={`${day}_close`} className="sr-only">{DAY_LABELS[day]} closing time</label>
                <input id={`${day}_close`} name={`${day}_close`} defaultValue={ranges[0]?.[1] ?? ""} placeholder="17:00" className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input type="checkbox" name={`${day}_closed`} defaultChecked={closed} /> Closed
              </label>
            </fieldset>
          );
        })}
      </div>
      <button type="submit" disabled={pending} className={`mt-4 ${buttonCls}`}>
        {pending ? "Saving…" : "Save hours"}
      </button>
      <p aria-live="polite" className={`mt-2 text-sm ${state.status === "error" ? "text-accent" : "text-ink-muted"}`}>
        {state.message}
      </p>
    </form>
  );
}

export function ServiceForm() {
  const [state, action, pending] = useActionState(saveService, {
    status: "idle",
    message: "",
  } as SettingsState);
  return (
    <form action={action} className="grid max-w-xl gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sf-name" className={labelCls}>Service name</label>
          <input id="sf-name" name="name" required className={inputCls} placeholder="Lift kits" />
        </div>
        <div>
          <label htmlFor="sf-slug" className={labelCls}>URL slug</label>
          <input id="sf-slug" name="slug" required pattern="[a-z0-9-]+" className={inputCls} placeholder="lift-kits" />
        </div>
      </div>
      <div>
        <label htmlFor="sf-blurb" className={labelCls}>One-line description</label>
        <input id="sf-blurb" name="blurb" className={inputCls} placeholder="What it is, in a sentence" />
      </div>
      <button type="submit" disabled={pending} className={`justify-self-start ${buttonCls}`}>
        {pending ? "Saving…" : "Add / update service"}
      </button>
      <p aria-live="polite" className={`text-sm ${state.status === "error" ? "text-accent" : "text-ink-muted"}`}>
        {state.message}
      </p>
    </form>
  );
}

export function PostEditor({ post }: { post: ContentRow | null }) {
  const [state, action, pending] = useActionState(savePost, {
    status: "idle",
    message: "",
  } as ContentSaveState);
  const fm = post?.frontmatter;
  return (
    <form action={action} className="grid max-w-3xl gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pe-title" className={labelCls}>Title</label>
          <input id="pe-title" name="title" required defaultValue={fm?.title ?? ""} className={inputCls} />
        </div>
        <div>
          <label htmlFor="pe-slug" className={labelCls}>Slug</label>
          <input id="pe-slug" name="slug" required pattern="[a-z0-9-]+" defaultValue={post?.slug ?? ""} readOnly={!!post} className={`${inputCls} ${post ? "opacity-60" : ""}`} />
        </div>
      </div>
      <div>
        <label htmlFor="pe-description" className={labelCls}>Description (for search results)</label>
        <input id="pe-description" name="description" required defaultValue={fm?.description ?? ""} className={inputCls} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="pe-date" className={labelCls}>Date (YYYY-MM-DD)</label>
          <input id="pe-date" name="date" required pattern="\d{4}-\d{2}-\d{2}" defaultValue={fm?.date ?? new Date().toISOString().slice(0, 10)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="pe-author" className={labelCls}>Author</label>
          <input id="pe-author" name="author" required defaultValue={fm?.author ?? ""} className={inputCls} />
        </div>
        <div>
          <label htmlFor="pe-tags" className={labelCls}>Tags (comma-separated)</label>
          <input id="pe-tags" name="tags" defaultValue={(fm?.tags ?? []).join(", ")} className={inputCls} />
        </div>
      </div>
      <div>
        <label htmlFor="pe-body" className={labelCls}>Body (markdown)</label>
        <textarea id="pe-body" name="body" required rows={18} defaultValue={post?.body ?? ""} className={`${inputCls} font-mono text-sm`} />
      </div>
      <label className="flex items-center gap-2 text-sm font-bold text-ink">
        <input type="checkbox" name="publish" defaultChecked={!!post?.published_at} /> Published
      </label>
      <button type="submit" disabled={pending} className={`justify-self-start ${buttonCls}`}>
        {pending ? "Saving…" : "Save post"}
      </button>
      <p aria-live="polite" className={`text-sm ${state.status === "error" ? "text-accent" : "text-ink-muted"}`}>
        {state.message}
      </p>
    </form>
  );
}
