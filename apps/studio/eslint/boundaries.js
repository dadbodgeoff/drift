// Feature-sliced boundaries for apps/studio/src:
//   app -> features -> entities -> shared   (each layer imports only layers to its right)
// and a slice is entered only through its public entry point (index.ts):
//   `@/features/map` is fine, `@/features/map/nodes` is not (outside the slice).
const LAYERS = ["app", "features", "entities", "shared"];

function locate(file) {
  const m = /[/\\]apps[/\\]studio[/\\]src[/\\](app|features|entities|shared)(?:[/\\]([^/\\]+))?/.exec(file);
  return m ? { layer: m[1], slice: m[2] ?? null } : null;
}

function target(spec) {
  const m = /^@\/(app|features|entities|shared)(?:\/([^/]+))?(\/.+)?$/.exec(spec);
  return m ? { layer: m[1], slice: m[2] ?? null, deep: !!m[3] } : null;
}

const rule = {
  meta: { type: "problem", messages: { layer: "{{from}} may not import from {{to}} (app → features → entities → shared).", deep: "Import {{slice}} through its public entry point (@/{{layer}}/{{slice}}), not {{spec}}.", relative: "Cross-slice imports must use the @/ alias, not a relative path." }, schema: [] },
  create(context) {
    const here = locate(context.filename ?? context.getFilename());
    if (!here) return {};
    return {
      ImportDeclaration(node) {
        const spec = node.source.value;
        if (spec.startsWith("..") && here.layer !== "shared") {
          const depth = spec.split("/").filter((p) => p === "..").length;
          if (depth >= 2) context.report({ node, messageId: "relative" });
          return;
        }
        const t = target(spec);
        if (!t) return;
        if (LAYERS.indexOf(t.layer) < LAYERS.indexOf(here.layer)) {
          context.report({ node, messageId: "layer", data: { from: here.layer, to: t.layer } });
          return;
        }
        const sameSlice = t.layer === here.layer && t.slice === here.slice;
        if (t.layer !== "shared" && t.deep && !sameSlice) context.report({ node, messageId: "deep", data: { slice: t.slice, layer: t.layer, spec } });
        if (t.layer === here.layer && t.layer === "features" && !sameSlice) context.report({ node, messageId: "layer", data: { from: `features/${here.slice}`, to: `features/${t.slice}` } });
      },
    };
  },
};

export default { rules: { boundaries: rule } };
