import { describe, expect, it } from "vitest";
import { CHANNELS, SessionState, channels } from "@/shared/ipc/contract";
import { CHANNEL_NAMES } from "@/shared/ipc/names";

describe("IPC contract", () => {
  it("names the same channels in the preload list and the schema table", () => {
    expect([...CHANNELS].sort()).toEqual([...CHANNEL_NAMES].sort());
  });
  it("rejects requests that leave the repository or name odd ids", () => {
    const repo = { path: "/r", name: "r" };
    expect(channels.readSource.req.safeParse([repo, "../etc/passwd"]).success).toBe(false);
    expect(channels.readSource.req.safeParse([repo, "/etc/passwd"]).success).toBe(false);
    expect(channels.readSource.req.safeParse([repo, "a\\b"]).success).toBe(false);
    expect(channels.readSource.req.safeParse([repo, "apps/web/x.ts"]).success).toBe(true);
    expect(channels.review.req.safeParse([repo, "accept", ["D-zzzzzz"]]).success).toBe(false);
    expect(channels.review.req.safeParse([repo, "delete", ["D-abcdef"]]).success).toBe(false);
    expect(channels.review.req.safeParse([repo, "block", ["D-abcdef"]]).success).toBe(true);
    expect(channels.readTranscript.req.safeParse([repo, "../../x"]).success).toBe(false);
  });
  it("keeps told_person in session state (#45), empty for older drift", () => {
    const key = "exempt D-1a2b3c src/a.ts#Pinger";
    expect(SessionState.parse({ baseline: [], advised: [], told_person: [key], primed: [], blocks: 0, last_block: [] }).told_person).toEqual([key]);
    expect(SessionState.parse({ baseline: [], advised: [] }).told_person).toEqual([]);
  });
});
