# Ekko Studio

Electron desktop distribution for Ekko Studio.

## Install

Download the latest macOS, Windows, or Linux installer for your CPU
architecture from the project
[GitHub Releases](https://github.com/EKKOLearnAI/ekko-studio/releases/latest).

The desktop app bundles the Web UI runtime and launches it locally from the
native shell app.

### Release asset names

Installers use `Ekko.Studio-${version}-${arch}.${ext}`. Publish the new
artifacts before deploying the website download page with the matching names.

Keep the application ID, signing identity, update feeds, and Linux package
identity stable. Update manifests reference the actual artifact filenames.
Validate an upgrade from the previous signed release on macOS and Windows
before rollout.

For isolated A → B testing without a production Release, use the
[desktop update testing guide](UPDATE-TESTING.md) and the **Desktop Update Test Build**
workflow. Test packages use a fixed HTTPS test feed and never fall back to production.

## Command shims

After the packaged desktop app starts, it installs managed command shims:

| Command | Description |
| --- | --- |
| `ekko-studio` | Open the Ekko Studio desktop app |
| `ekko-studio cli ...` | Run the bundled Hermes Agent CLI |
| `ekko-studio web ...` | Run the bundled `hermes-web-ui` command |
| `ekko-studio -h` | Show wrapper help |
| `ekko-studio-mcp` | Run the managed Web UI MCP bridge |

The desktop command is `ekko-studio`; the previous managed `hermes-studio`
command is removed when the new shim is installed. No compatibility alias is created.

Use `ekko-studio cli -h` for Hermes Agent CLI help and
`ekko-studio web -h` for Web UI CLI help.

## Data directories

On Windows, the first packaged launch after the rename updates the existing
Studio startup entry from `Hermes Studio.exe` to `Ekko Studio.exe` in the same
installation directory. Its Task Manager enabled/disabled state is preserved.
No entry is created if startup was never enabled; custom entries and machine-wide
entries are left alone. The migration is safe to retry on later launches.

Hermes Agent data is stored in `~/.hermes` on Windows, macOS, and Linux.

The desktop wrapper's own Web UI state is stored separately in
`~/.hermes-web-ui` unless `HERMES_WEB_UI_HOME` is set.

## Remote server mode

The desktop app can open a remote Ekko Studio server instead of starting its
bundled local server. Create `remote-servers.json` in the app's user data
directory (Electron `userData`, for example `~/.config/hermes-studio` on Linux):

```json
{ "active": "chloe", "servers": [ { "name": "chloe", "url": "http://10.23.23.140:8648" } ] }
```

- The file is the allowlist. There is no UI for typing a URL.
- Only `http:` and `https:` URLs without a username or password are accepted.
  Each URL is reduced to its origin. Invalid entries are skipped with a console warning.
- If the file cannot be read or `active` does not name a valid entry, the app shows
  an error dialog and starts in local mode. Delete the file to return to local mode.
- `EKKO_REMOTE_SERVER_URL=<url>` overrides the file with a single server (for testing).
- With more than one server, the tray menu has a **Servers** submenu. Choosing a
  server saves it as `active` and reloads the windows on that server. Chat windows
  from the previous server are closed. Each server keeps its own browser login.

In remote mode the app does not prepare the local runtime, start the local server,
install command shims, start the embedded browser, or run the auto-updater. The tray
hides **Check for Updates** and **Reset Login**. You sign in with the remote server's
own login. The desktop never sends its local token to a remote page. The remote page
cannot use the embedded browser, the updater, app restart, the runtime directory picker
or the open-external-URL call; links open in the system browser instead. The desktop
pet window and the desktop MCP bridge stay on this computer, and agents on the remote
server cannot reach them. The remote page still gets notifications, microphone access
and chat windows, so only list servers you trust.

### Request headers per server

A server entry may carry static request headers, for example a Cloudflare Access
service token so the app skips the Access login page:

```json
{ "active": "chloe", "servers": [ { "name": "chloe", "url": "https://ekko-chloe.hyades.io",
  "headers": { "CF-Access-Client-Id": "<id>", "CF-Access-Client-Secret": "<secret>" } } ] }
```

- The main process adds the headers only to requests whose origin (scheme, host and
  port) is exactly that server's origin: page loads, fetch/XHR and the WebSocket
  upgrade. Requests to any other origin, including redirects elsewhere, get none.
  The headers are never passed to the page, the preload script or IPC, and are never logged.
- `headers` is an object of at most 16 string values. Names must be RFC 7230 tokens;
  values must not contain CR, LF or NUL. `Host`, `Cookie`, `Origin`, `Content-Length`,
  `Transfer-Encoding`, `Connection` and `Upgrade` are refused. An invalid `headers`
  object skips the whole entry.
- The file then holds secrets. Restrict it to your user (`chmod 600 remote-servers.json`).
  A tray server switch rewrites the file with mode 600.
- `EKKO_REMOTE_SERVER_URL` cannot carry headers.

## Desktop and tray icons

Regenerate the rounded Windows desktop icon and macOS, Windows, and Linux tray
icons from `build/icon.png` by running this command from the repository root:

```sh
node packages/desktop/scripts/generate-rounded-icons.mjs
```

The script preserves the original artwork and applies a transparent rounded-square
mask at each output size (16% corner radius for Windows, 26% for macOS/Linux trays).
It writes `iconWindows.png`, the multi-resolution
`icon.ico`, and the platform tray PNGs. Linux uses a separate `trayLinux.png` asset.

## China mirror environment

These mirrors are optional and are not required in CI:

```sh
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

If GitHub release downloads are slow, `fetch-python.mjs` can also use a compatible
python-build-standalone release mirror:

```sh
export PBS_BASE_URL=https://github.com/astral-sh/python-build-standalone/releases/download
```
