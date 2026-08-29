/**
 * Client-side helpers retained from the golden master.
 *
 * Server-side purge/archive routines previously shared this file in the
 * Next.js source. They intentionally do not belong in the Vite browser bundle;
 * persistence lifecycle work will live in the Cloudflare Worker/domain layer.
 */

/** Calculate the deletion date (7 days from now). */
export function getDeletionDate(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

/** Format a countdown string (e.g., "5 days left", "12 hours left"). */
export function formatDeletionCountdown(deletedAt: Date): string {
  const now = new Date();
  const diff = deletedAt.getTime() - now.getTime();

  if (diff <= 0) return "Expiring soon";

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} left`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} left`;
  return "Less than 1 hour left";
}
