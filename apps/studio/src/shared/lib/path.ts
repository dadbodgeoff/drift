// Long repository paths, shortened from the middle so the file name stays visible.
export function middlePath(p: string, max = 48): string {
  if (p.length <= max) return p;
  const segs = p.split("/");
  const last = segs.pop() ?? "";
  let tail = last;
  for (let i = segs.length - 1; i >= 0; i--) {
    const next = `${segs[i]}/${tail}`;
    if (next.length + 2 > max - segs[0].length - 1) break;
    tail = next;
  }
  return tail === p ? p : `${segs[0]}/…/${tail}`;
}
