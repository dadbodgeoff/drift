import { describe, expect, it } from "vitest";
import { langOf, tokenLines, tokenize } from "../src/code/tokenize";

const kinds = (src: string, lang: "ts" | "py" = "ts") => tokenize(src, lang).filter((t) => t.kind !== "plain" && t.kind !== "punct").map((t) => `${t.kind}:${t.text}`);

describe("tokenizer", () => {
  it("highlights TypeScript", () => {
    expect(kinds('export const GET = withWorkspace(async () => "x"); // ok')).toEqual(["keyword:export", "keyword:const", "type:GET", "function:withWorkspace", "keyword:async", 'string:"x"', "comment:// ok"]);
  });
  it("recognises JSX after return and decorators", () => {
    expect(kinds("return <PageShell title='a'>")).toContain("tag:PageShell");
    expect(kinds("@Controller('x') class A {}")).toContain("decorator:@Controller");
    expect(kinds("a < b")).not.toContain("tag:b");
  });
  it("keeps multi-line comments and templates intact across lines", () => {
    const lines = tokenLines("/* a\nb */ x\n`t\n${y}`");
    expect(lines[1][0]).toEqual({ kind: "comment", text: "b */" });
    expect(lines[3][0].kind).toBe("string");
  });
  it("highlights Python", () => {
    expect(kinds('@router.get("/x")\nasync def read(): # c\n    return """doc"""', "py")).toEqual(["decorator:@router.get", 'string:"/x"', "keyword:async", "keyword:def", "function:read", "comment:# c", "keyword:return", 'string:"""doc"""']);
  });
  it("never produces markup: text round-trips", () => {
    const src = '<img src=x onerror="alert(1)">\n</script><script>alert(2)</script>';
    expect(tokenize(src).map((t) => t.text).join("")).toBe(src);
  });
  it("picks a highlighter by path or Drift lang tag", () => {
    expect(langOf("a/b.tsx")).toBe("ts");
    expect(langOf("py")).toBe("py");
    expect(langOf("README.md")).toBe("plain");
  });
});

describe("graph layout", () => {
  it("lays out nested graphs (ELK hierarchical mode) with routed edges", async () => {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const { collect, toElk } = await import("../src/graph/layout");
    const nodes = [
      { id: "a", parent: null, width: 100, height: 40 },
      { id: "a/x", parent: "a", width: 80, height: 30 },
      { id: "a/y", parent: "a", width: 80, height: 30 },
      { id: "b", parent: null, width: 100, height: 40 },
    ];
    const edges = [
      { id: "1", source: "a/x", target: "b" },
      { id: "2", source: "b", target: "a/y" },
      { id: "3", source: "a/x", target: "a/y" },
    ];
    const r = collect(await new ELK().layout(toElk(nodes, edges) as never));
    expect(Object.keys(r.positions).sort()).toEqual(["a", "a/x", "a/y", "b"]);
    expect(Object.keys(r.edges).sort()).toEqual(["1", "2", "3"]);
    expect(r.edges["1"].length).toBeGreaterThanOrEqual(2);
  });
});
