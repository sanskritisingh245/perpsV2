// Small display helpers. The backend stores money as decimal strings, so we
// parse only at the edge for formatting and never for re-submitting.

export function num(v: string | number | null | undefined, dp = 2): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function compact(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return "0";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  // keep some precision for small prices
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function shortId(id: string, n = 6): string {
  return id.length <= n ? id : id.slice(0, n);
}

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clockTime(d: number | Date = Date.now()): string {
  return new Date(d).toLocaleTimeString("en-US", { hour12: false });
}
