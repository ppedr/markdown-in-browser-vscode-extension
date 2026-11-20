import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface Renderer {
  mdToHtml: (md: string) => string;
  css: string;
}

// The renderer (parser + CSS) lives in viewer.html, between the //__MD_START__
// and //__MD_END__ markers, so the standalone drop-viewer and this extension
// always render the same way. Compiled code runs from out/, so viewer.html is one level up.
const VIEWER_PATH = path.join(__dirname, "..", "viewer.html");

function loadRenderer(): Renderer {
  const src = fs.readFileSync(VIEWER_PATH, "utf8");
  const code = src.match(/\/\/__MD_START__([\s\S]*?)\/\/__MD_END__/);
  const style = src.match(/<style>([\s\S]*?)<\/style>/);
  if (!code || !style) {
    throw new Error("viewer.html is missing the //__MD_START__/__MD_END__ markers or the <style> block");
  }
  const mdToHtml = new Function(code[1] + "\nreturn mdToHtml;")() as Renderer["mdToHtml"];
  return { mdToHtml, css: style[1] };
}

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
};
const MD_EXT = new Set([".md", ".markdown"]);

const isWin = process.platform === "win32";
const token = crypto.randomBytes(12).toString("hex");
let server: http.Server | null = null;
let port = 0;

// Open browser tabs listen here (Server-Sent Events) to know when to refresh.
const EVENTS_PATH = "/" + token + "/__events";
const eventClients = new Set<http.ServerResponse>();

// Identifies a file the same way on both sides: the page embeds it, save events send it.
function fileKey(fsPath: string): string {
  const p = path.resolve(fsPath);
  return isWin ? p.toLowerCase() : p;
}

function notifySaved(fsPath: string): void {
  const msg = `data: ${JSON.stringify(fileKey(fsPath))}\n\n`;
  for (const res of eventClients) res.write(msg);
}

function handleEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");
  eventClients.add(res);
  req.on("close", () => eventClients.delete(res));
}

// C:\docs\a b.md  ->  /<token>/C/docs/a%20b.md   (no drive colon in the URL)
function fileToUrlPath(fsPath: string): string {
  const segs = path.resolve(fsPath).split(path.sep).filter(Boolean);
  if (isWin) segs[0] = segs[0].replace(/:$/, "");
  return "/" + token + "/" + segs.map(encodeURIComponent).join("/");
}

function urlPathToFile(urlPath: string): string | null {
  let segs: string[];
  try {
    segs = urlPath.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segs.shift() !== token || segs.some((s) => s === ".." || /[\\/]/.test(s))) return null;
  if (isWin) {
    if (!segs.length) return null;
    return segs[0] + ":\\" + segs.slice(1).join("\\");
  }
  return "/" + segs.join("/");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readMarkdown(fsPath: string): string {
  // Prefer the open editor buffer so unsaved edits show up too.
  const wanted = fileKey(fsPath);
  const doc = vscode.workspace.textDocuments.find(
    (d) => d.uri.scheme === "file" && fileKey(d.uri.fsPath) === wanted
  );
  return doc ? doc.getText() : fs.readFileSync(fsPath, "utf8");
}

// A JS string literal that is safe to drop inside a <script> block.
function scriptString(s: string): string {
  return JSON.stringify(s).replace(/</g, "\\u003c");
}

function renderPage(fsPath: string): string {
  const { mdToHtml, css } = loadRenderer();
  const body = mdToHtml(readMarkdown(fsPath));
  const name = path.basename(fsPath);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(name)} — MD Viewer</title>
<style>${css}
  #content{display:block;padding-top:72px;}
  #filebar{display:block;}
</style></head>
<body class="has-file">
<div id="filebar"><span>${escapeHtml(fsPath)}</span></div>
<div id="content">${body}</div>
<script>
(function () {
  var FILE_KEY = ${scriptString(fileKey(fsPath))};
  var EVENTS = ${scriptString(EVENTS_PATH)};
  var content = document.getElementById("content");

  // Relative links (other .md files, local docs) open in this same tab;
  // external links keep opening in a new one.
  function fixLinks() {
    content.querySelectorAll("a[href]").forEach(function (a) {
      var h = a.getAttribute("href");
      if (!/^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith("//")) a.removeAttribute("target");
    });
  }
  fixLinks();

  // When this file is saved in VS Code, swap in the new content in place,
  // so the scroll position stays where it was.
  function refresh() {
    fetch(location.href, { cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var next = new DOMParser().parseFromString(html, "text/html").getElementById("content");
        if (!next) return;
        content.innerHTML = next.innerHTML;
        fixLinks();
      })
      .catch(function () {});
  }

  var es = new EventSource(EVENTS);
  es.onmessage = function (e) {
    if (JSON.parse(e.data) === FILE_KEY) refresh();
  };
})();
</script>
</body></html>`;
}

function send(res: http.ServerResponse, status: number, type: string, data: string): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

function notFoundPage(fsPath: string): string {
  return `<body style="background:#0d1117;color:#c9d1d9;font-family:sans-serif;padding:40px">
<h2>Not found</h2><p>${escapeHtml(fsPath)}</p>
<p><a style="color:#58a6ff" href="javascript:history.back()">&larr; back</a></p></body>`;
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === EVENTS_PATH) return handleEvents(req, res);
  const fsPath = urlPathToFile(url.pathname);
  if (!fsPath) return send(res, 403, "text/plain", "Forbidden");

  fs.stat(fsPath, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, "text/html; charset=utf-8", notFoundPage(fsPath));
    }
    const ext = path.extname(fsPath).toLowerCase();
    if (MD_EXT.has(ext) && !url.searchParams.has("raw")) {
      try {
        return send(res, 200, "text/html; charset=utf-8", renderPage(fsPath));
      } catch (e) {
        return send(res, 500, "text/plain; charset=utf-8", e instanceof Error ? e.stack ?? e.message : String(e));
      }
    }
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(fsPath).pipe(res);
  });
}

function ensureServer(): Promise<void> {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = http.createServer(handle);
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      server = s;
      port = (s.address() as { port: number }).port;
      resolve();
    });
  });
}

async function openInBrowser(arg?: unknown): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    vscode.window.showWarningMessage("Open in Browser: select a local .md file.");
    return;
  }
  await ensureServer();
  const target = `http://127.0.0.1:${port}${fileToUrlPath(uri.fsPath)}`;
  await vscode.env.openExternal(vscode.Uri.parse(target));
}

function stopServer(): void {
  for (const res of eventClients) res.end();
  eventClients.clear();
  server?.close();
  server = null;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mdBrowser.open", openInBrowser),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === "file") notifySaved(doc.uri.fsPath);
    }),
    { dispose: stopServer }
  );
}

export function deactivate(): void {
  stopServer();
}
