// The scope switch PR mode shares: the whole repository, or what a change introduces since its merge base with a
// ref (`--diff-base`). Check (`drift check`) and Security (`drift security`) use the same switch, ref field,
// validation and remembered base.
import { useState } from "react";
import { Button, Input, SegmentedControl } from "@drift/ui";
import { baseFor, validRef } from "./model";

/** The diff base last used for a repository (a per-viewer convenience; never required). */
function savedBase(repoPath: string | undefined): string {
  try {
    return (repoPath && localStorage.getItem(`drift-studio:diff-base:${repoPath}`)) || "origin/main";
  } catch {
    return "origin/main";
  }
}
function saveBase(repoPath: string | undefined, base: string) {
  try {
    if (repoPath) localStorage.setItem(`drift-studio:diff-base:${repoPath}`, base);
  } catch {
    // memory only
  }
}

export interface DiffScopeState {
  /** The base in effect, or null for the whole repository. */
  base: string | null;
  setBase(b: string | null): void;
  /** The ref field's text. */
  draft: string;
  setDraft(ref: string): void;
  /** Compare against the ref in the field, when it is a plain ref; false otherwise. */
  apply(): boolean;
}

/**
 * Scope state for one view. The base belongs to the repository it was chosen for: switching repositories starts on
 * the whole repository. The ref field starts on the base last used for the repository.
 */
export function useDiffScope(repoPath: string | undefined): DiffScopeState {
  const [scope, setScope] = useState<{ repo: string; base: string } | null>(null);
  const base = baseFor(scope, repoPath);
  const setBase = (b: string | null) => setScope(b && repoPath ? { repo: repoPath, base: b } : null);
  const [draftFor, setDraftFor] = useState<{ repo: string | undefined; ref: string }>(() => ({ repo: repoPath, ref: savedBase(repoPath) }));
  const draft = draftFor.repo === repoPath ? draftFor.ref : savedBase(repoPath);
  const setDraft = (ref: string) => setDraftFor({ repo: repoPath, ref });
  const apply = () => {
    const r = draft.trim();
    if (!validRef(r)) return false;
    saveBase(repoPath, r);
    setBase(r);
    return true;
  };
  return { base, setBase, draft, setDraft, apply };
}

/** Whole repository / Changes since base, the ref field (only plain refs; the main process checks again) and the exact command. */
export function DiffScope({ scope, tool, command, onApply }: { scope: DiffScopeState; tool: string; command: (base: string | null) => string; onApply?(): void }) {
  const { base, setBase, draft, setDraft } = scope;
  const apply = () => {
    if (scope.apply()) onApply?.();
  };
  return (
    <div className="ck-scope" role="group" aria-label={`What ${tool} reports`}>
      <SegmentedControl<"repo" | "diff">
        label="Scope"
        size="sm"
        value={base ? "diff" : "repo"}
        onValueChange={(v) => (v === "repo" ? setBase(null) : apply())}
        items={[
          { value: "repo", label: "Whole repository" },
          { value: "diff", label: "Changes since base" },
        ]}
      />
      <form
        className="ck-scope__form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Input
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Base ref for ${tool} --diff-base`}
          placeholder="origin/main"
          invalid={!!draft.trim() && !validRef(draft.trim())}
          className="dui-mono ck-scope__ref"
          spellCheck={false}
        />
        <Button size="sm" type="submit" variant={base ? "ghost" : "secondary"} disabled={!validRef(draft.trim()) || draft.trim() === base}>
          Compare
        </Button>
      </form>
      <code className="st-cmd ck-scope__cmd" title="The command this view runs">
        {command(base)}
      </code>
    </div>
  );
}
