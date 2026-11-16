// Drift Studio's Electron main process. The window is sandboxed, isolated and
// has no Node; it can only call the named channels in the IPC contract, each
// validated here before StudioMain runs it.
import { existsSync, readFileSync, watch } from "node:fs";
import { homedir, userInfo } from "node:os";
import { extname, join, normalize, relative, resolve } from "node:path";
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, session, shell } from "electron";
import { type Channel, channels } from "../src/shared/ipc/contract";
import { CHANNEL_NAMES, CHANNEL_PREFIX } from "../src/shared/ipc/names";
import { StudioMain } from "./handlers";
import { InvalidArgument } from "./ops";
import { Store } from "./store";

const APP_ORIGIN = "studio://app";
const DEV_URL = process.env.STUDIO_DEV_URL ?? null;
const RENDERER_DIR = resolve(__dirname, "..", "dist");
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".json": "application/json" };

// For automated runs: an isolated data directory and a repository to open.
if (process.env.STUDIO_USER_DATA) app.setPath("userData", process.env.STUDIO_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: "studio", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// Sandbox every renderer. (Containers that run as root must pass --no-sandbox,
// which Chromium requires there; webPreferences.sandbox still applies.)
if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();

let win: BrowserWindow | null = null;
const studio = new StudioMain({
  store: new Store(join(app.getPath("userData"), "studio")),
  projectsDir: join(homedir(), ".claude", "projects"),
  user: (() => {
    try {
      return userInfo().username;
    } catch {
      return "unknown";
    }
  })(),
  appVersion: app.getVersion(),
  platform: process.platform,
  dialogs: {
    async chooseDirectory(title) {
      const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    async chooseFile(title) {
      const r = await dialog.showOpenDialog(win!, { title, properties: ["openFile"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    async chooseSavePath(name) {
      const r = await dialog.showSaveDialog(win!, { defaultPath: name });
      return r.canceled ? null : (r.filePath ?? null);
    },
  },
});

function trustedSender(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    // Custom schemes have an opaque ("null") origin in WHATWG URLs: compare scheme and host.
    if (u.protocol === "studio:" && u.host === "app") return true;
    return !!DEV_URL && u.origin === new URL(DEV_URL).origin;
  } catch {
    return false;
  }
}

function dispatch(c: Channel, args: unknown[], requestId: string | undefined): unknown {
  const s = studio;
  switch (c) {
    case "handshake":
      return s.handshake();
    case "recentRepos":
      return s.recentRepos();
    case "openRepo":
      return s.openRepo();
    case "forgetRepo":
      return s.forgetRepo(args[0] as never);
    case "driftInfo":
      return s.driftInfo();
    case "chooseDrift":
      return s.chooseDrift(args[0] as boolean);
    case "facts": {
      const repo = args[0] as { path: string };
      const out = s.facts(repo as never, args[1] as never, requestId);
      if (s.recentRepos().some((r) => r.path === repo.path) && watching !== repo.path) watchRepo(repo.path);
      return out;
    }
    case "census":
      return s.census(args[0] as never, requestId);
    case "check":
      return s.check(args[0] as never, args[1] as never, requestId);
    case "security":
      return s.security(args[0] as never, args[1] as never, requestId);
    case "securityTop":
      return s.securityTop(args[0] as never, args[1] as number, requestId);
    case "securityBaseline":
      return s.securityBaseline(args[0] as never);
    case "practices":
      return s.practices(args[0] as never, requestId);
    case "map":
      return s.map(args[0] as never, requestId);
    case "funnel":
      return s.funnel(args[0] as never, requestId);
    case "promoteList":
      return s.promoteList(args[0] as never, requestId);
    case "policy":
      return s.policy(args[0] as never);
    case "review":
      return s.review(args[0] as never, args[1] as never, args[2] as never);
    case "exempt":
      return s.exempt(args[0] as never, args[1] as string, args[2] as string, args[3] as string | null);
    case "setReviewLog":
      return s.setReviewLog(args[0] as never, args[1] as boolean);
    case "exportReviewLog":
      return s.exportReviewLog(args[0] as never, args[1] as never);
    case "reviewShown":
      return s.reviewShown(args[0] as never, args[1] as string[]);
    case "reviewLogExport":
      return s.reviewLogExport(args[0] as never);
    case "reviewQuestions":
      return s.reviewQuestions(args[0] as never);
    case "answer":
      return s.answer(args[0] as never, args[1] as string, args[2] as string, args[3] as string[], args[4] as string[]);
    case "init":
      return s.init(args[0] as never);
    case "promotePreview":
      return s.promotePreview(args[0] as never, args[1] as never, requestId);
    case "promote":
      return s.promote(args[0] as never, args[1] as never);
    case "readSource":
      return s.readSource(args[0] as never, args[1] as string);
    case "listSessions":
      return s.listSessions(args[0] as never, args[1] as never);
    case "readTranscript":
      return s.readTranscript(args[0] as never, args[1] as string);
    case "readSessionState":
      return s.readSessionState(args[0] as never, args[1] as string);
    case "loadStudies":
      return s.loadStudies(args[0] as never);
    case "history":
      return s.history(args[0] as never);
    case "recordSnapshot":
      return s.recordSnapshot(args[0] as never, args[1] as never);
    case "clearHistory":
      return s.clearHistory(args[0] as never);
    case "logs":
      return s.logs();
    case "log":
      return s.addLog(args[0] as never);
    case "saveText":
      return s.saveText(args[0] as string, args[1] as string);
    case "cancel":
      return s.cancel(args[0] as string);
  }
}

function registerIpc() {
  for (const name of CHANNEL_NAMES) {
    ipcMain.handle(`${CHANNEL_PREFIX}${name}`, async (event, args: unknown, requestId: unknown) => {
      if (!trustedSender(event.senderFrame?.url)) throw new Error("untrusted sender");
      const parsed = channels[name].req.safeParse(args);
      if (!parsed.success) throw new InvalidArgument(`invalid arguments for ${name}: ${parsed.error.issues[0]?.message ?? ""}`);
      const id = typeof requestId === "string" && requestId.length <= 64 ? requestId : undefined;
      return dispatch(name, parsed.data as unknown[], id);
    });
  }
}

let unwatch: (() => void) | null = null;
let watching: string | null = null;
const SOURCE = /\.(?:[cm]?[jt]sx?|py|json|ya?ml|prisma|sql)$/;

/** Tell the window when files change under an open repository (the data is then stale). */
function watchRepo(root: string) {
  unwatch?.();
  watching = root;
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  try {
    const w = watch(root, { recursive: true }, (_e, file) => {
      const f = String(file ?? "");
      if (!f || /(^|[/\\])(node_modules|\.git|\.drift)([/\\]|$)/.test(f) || !SOURCE.test(f)) return;
      changed.add(f.replace(/\\/g, "/"));
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        win?.webContents.send("studio:event:repoChanged", { repo: root, changed: changed.size, sample: [...changed].slice(0, 8) });
      }, 800);
    });
    unwatch = () => w.close();
  } catch (e) {
    studio.log("warn", "cannot watch the repository for changes", { error: (e as Error).message });
  }
}

function serveRenderer() {
  protocol.handle("studio", async (req) => {
    const url = new URL(req.url);
    if (url.host !== "app") return new Response("not found", { status: 404 });
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "") || "index.html";
    const file = resolve(RENDERER_DIR, rel);
    const r = relative(RENDERER_DIR, file);
    if (r.startsWith("..") || !existsSync(file)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(file), {
      headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-security-policy": CSP, "x-content-type-options": "nosniff" },
    });
  });
  void net;
}

function createWindow() {
  const mac = process.platform === "darwin";
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0a0d12",
    show: false,
    titleBarStyle: mac ? "hiddenInset" : "hidden",
    titleBarOverlay: mac ? false : { color: "#0a0d12", symbolColor: "#aab3c0", height: 44 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once("ready-to-show", () => win?.show());
  const wc = win.webContents;
  // No navigation away from the app, no new windows, no webviews.
  wc.on("will-navigate", (e, url) => {
    if (!trustedSender(url)) e.preventDefault();
  });
  wc.on("will-redirect", (e, url) => {
    if (!trustedSender(url)) e.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-attach-webview", (e) => e.preventDefault());
  wc.on("zoom-changed", (_e, dir) => {
    const z = wc.getZoomFactor();
    wc.setZoomFactor(Math.min(2, Math.max(0.8, z + (dir === "in" ? 0.1 : -0.1))));
  });
  void (DEV_URL ? win.loadURL(DEV_URL) : win.loadURL(`${APP_ORIGIN}/index.html`));
  void shell;
}

// One instance: two would read-modify-write the same history (and audit trail).
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

app.whenReady().then(() => {
  // Deny every permission (camera, notifications, ...): the Studio needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  serveRenderer();
  registerIpc();
  const preopen = process.env.STUDIO_OPEN_REPO;
  if (preopen && existsSync(preopen)) studio.preopen(preopen);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }])] },
      { role: "windowMenu" },
    ]),
  );
  createWindow();
});

app.on("window-all-closed", () => {
  unwatch?.();
  app.quit();
});
