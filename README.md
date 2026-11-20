# Markdown in Browser

A VS Code extension that opens Markdown files rendered in your browser, on a clean page without the editor around it.

## Usage

Right-click a `.md` file and choose **Open in Browser**. The command is available from:

- the Explorer context menu
- the editor and editor tab context menus
- the globe icon in the editor title bar
- the Command Palette: `Markdown: Open in Browser`

On the page that opens:

- relative links to other `.md` files open rendered in the same tab, and the browser's back button works
- images and other files with relative paths load normally
- external links open in a new tab
- when you save the file in VS Code, the page updates by itself and keeps its scroll position
- unsaved changes in the editor show up when you reload the page (F5)

## How it works

The first time the command runs, the extension starts an HTTP server on `127.0.0.1`, on a free port, and opens the default browser on it. The server stops when VS Code closes.

The URL carries a random token generated for each session. Requests without it get a 403, so other websites open in the browser cannot read files through the server.

The file path goes in the URL itself (`C:\docs\a.md` becomes `/<token>/C/docs/a.md`), so the browser resolves relative links on its own, with no special handling.

Each open page keeps a Server-Sent Events connection to the server. When a file is saved in VS Code, the server notifies every tab. The tab showing that file fetches the HTML again and swaps only the content, without reloading the whole page.

Rendering uses the parser and CSS from `viewer.html`. The extension reads the code between the `//__MD_START__` and `//__MD_END__` markers and the `<style>` block on every page it serves, so changes to `viewer.html` apply to the extension with no extra step.

## Standalone viewer.html

`viewer.html` also works without the extension. Open it in a browser and drop a `.md` file on the page. To follow links between files, drop them together or use **open project folder** (Chromium browsers only).

## Development

The extension is written in TypeScript and compiled with `tsc` to `out/`. It has no runtime dependencies, only development tools.

| File | Contents |
| --- | --- |
| `src/extension.ts` | command, HTTP server and page assembly |
| `viewer.html` | Markdown parser and CSS, and the standalone viewer |
| `package.json` | extension manifest: commands and menus |
| `tsconfig.json` | compiler configuration |

The parser inside `viewer.html` stays in JavaScript because it also runs directly in the browser.

```sh
npm install         # once
npm run compile     # compile to out/
npm run watch       # recompile on every change
```

To try it, open the folder in VS Code and press F5 with an `extensionHost` launch configuration. This opens a separate window with the extension loaded.

To package and install (packaging compiles first):

```sh
npm run package
npm run install-local   # code --install-extension markdown-in-browser-<version>.vsix
```

After installing, run **Developer: Reload Window** to load the new version.

## Limitations

- The Markdown parser is simple: it covers headings, lists (including task lists), tables, code blocks, blockquotes, links and images. There is no syntax highlighting, no footnotes and no inline HTML.
- Headings get no `id`, so anchor links (`#section`) do not scroll the page.
- Live update only happens on saves made in VS Code. Changes made by another program need F5.
- If VS Code closes, the page stops updating. When it opens again the server uses another port and token, so you need to run **Open in Browser** again.
- Only local files (the `file` scheme) are supported, not remote workspaces.
