export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
