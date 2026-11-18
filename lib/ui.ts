import { ConvexError } from "convex/values";
import type { Doc } from "@/convex/_generated/dataModel";

export const CATEGORY_LABELS: Record<Doc<"tools">["category"], string> = {
  "power-tools": "Power tools",
  "hand-tools": "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITION_LABELS: Record<Doc<"tools">["condition"], string> = {
  "like-new": "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Worn but works",
};

export const isCategory = (value: string | null): value is Doc<"tools">["category"] =>
  value !== null && value in CATEGORY_LABELS;

// Server rule messages come back as ConvexError data; anything else gets a generic line (details stay in logs).
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Something went wrong. Please try again.";
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(at: number, now = Date.now()): string {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
export const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));

// The user's local calendar date, for date input minimums.
export function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
