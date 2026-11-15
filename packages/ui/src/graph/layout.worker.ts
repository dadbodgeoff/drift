// Graph layout off the main thread: ELK's layered algorithm with nested
// (compound) nodes. Messages carry plain data only.
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { type LayoutRequest, type LayoutResult, collect } from "./layout";

const elk = new ELK();

self.onmessage = async (e: MessageEvent<LayoutRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    const out = await elk.layout(req.graph as ElkNode);
    const res: LayoutResult = { id: req.id, ...collect(out), ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, positions: {}, edges: {}, ms: 0, error: String(err) } satisfies LayoutResult);
  }
};
