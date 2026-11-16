// Channel names and the IPC version, without schemas: the preload imports
// only this (it stays tiny and cannot reach anything else).

/** Bumped on any incompatible change to a channel's request or response. */
export const IPC_VERSION = 1;

export const CHANNEL_NAMES = [
  "handshake",
  "recentRepos",
  "openRepo",
  "forgetRepo",
  "driftInfo",
  "chooseDrift",
  "facts",
  "census",
  "check",
  "security",
  "securityTop",
  "securityBaseline",
  "practices",
  "map",
  "funnel",
  "promoteList",
  "policy",
  "review",
  "exempt",
  "setReviewLog",
  "exportReviewLog",
  "reviewShown",
  "reviewLogExport",
  "reviewQuestions",
  "answer",
  "init",
  "promotePreview",
  "promote",
  "readSource",
  "listSessions",
  "readTranscript",
  "readSessionState",
  "loadStudies",
  "history",
  "recordSnapshot",
  "clearHistory",
  "logs",
  "log",
  "saveText",
  "cancel",
] as const;

export const EVENT_NAMES = ["repoChanged"] as const;

/** Prefix for IPC channels, so nothing else on ipcMain can be reached. */
export const CHANNEL_PREFIX = "studio:";
