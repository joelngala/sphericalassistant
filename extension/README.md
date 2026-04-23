# Spherical Assistant — Chrome extension

Captures Hillsborough HOVER case documents into the matching matter folder in
Marc's Google Drive. Reuses the `/Spherical Assistant/{clientSlug}-case-{caseToken}/`
folder schema created by the React app (`src/lib/docs.ts`), so documents saved
from the extension appear in the same matter view as everything else.

## Status

- **v1 (this commit)**: end-to-end capture. On a HOVER case-detail page, the
  extension silently tracks which docket row you click. When the PDF opens in
  a new tab at `/FileManagement/ViewDocument`, a "Save to Spherical" panel
  appears with a matter dropdown, filename (pre-filled from case number +
  event description), and category — one click uploads the PDF to the
  selected matter folder in Drive.

## Local setup

### 1. Paste the OAuth client ID

Open `extension/lib/config.js` and set `OAUTH_CLIENT_ID` to the same Web
Application client ID the React app uses (`VITE_GOOGLE_CLIENT_ID`).

### 2. Load unpacked in Chrome

1. Visit `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and pick the `extension/` directory.
4. Copy the extension ID shown on the card (32-char string). You'll need it
   for step 3.

### 3. Register the extension's redirect URI in Google Cloud

Chrome's `launchWebAuthFlow` redirects to
`https://<EXTENSION_ID>.chromiumapp.org/oauth` — Google will reject the OAuth
request until that exact URI is registered as an authorized redirect on the
Web Application OAuth client.

1. Open
   [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Pick the Web Application client used by the React app.
3. Under **Authorized redirect URIs**, add
   `https://<EXTENSION_ID>.chromiumapp.org/oauth`.
4. Save.

### 4. Sanity check

1. Click the Spherical Assistant icon in the Chrome toolbar.
2. Click **Connect Google**. You should see the Google consent screen, then
   return to the popup with "Connected" and your email.
3. The matter dropdown should list any existing
   `/Spherical Assistant/...` folders from your Drive.
4. Pick one, click **Send test file to Drive**, then open Drive — you should
   see `spherical-test-<timestamp>.txt` inside the selected folder.

If all four steps work, the Drive plumbing is good and the remaining work is
purely HOVER-side.

## HOVER recon step (blocks v1)

Once the extension is loaded, visit any HOVER case-detail page. A blue
**Save to Spherical (probe)** button appears in the bottom-right corner.
Clicking it:

- Dumps the page's `<table>` headers + first few data rows to DevTools
  console.
- Collects all anchors that look like document links (PDF hrefs, `docview`,
  `/doc/`, `download`) and logs them.
- Copies the entire payload to the clipboard.

Paste that payload back to the developer. It tells us exactly which selectors
to use in the real capture content script (task #5 in the task list).

## Stable extension ID across installs

Chrome assigns a per-machine extension ID when loading unpacked. To keep one
consistent ID across dev machines (so the redirect URI doesn't have to be
re-added every time):

1. Generate a keypair:
   `openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem`
2. Derive the public key:
   `openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A`
3. Paste the base64 value into `manifest.json` as a top-level `"key": "..."`
   field.
4. Reload unpacked; the extension ID is now stable.

Not required for v1 local testing — skip unless Marc will be loading on
multiple machines.

## Architecture notes

- **No Worker involvement for Drive uploads.** The extension uses
  `drive.file` scope and calls Google Drive directly from the browser, same
  pattern as the React app. Tokens stay in `chrome.storage.local`, not on
  the Worker.
- **Matter folder schema matches `src/lib/docs.ts`.** The extension lists
  existing folders under `/Spherical Assistant/` rather than creating new
  ones — matter creation stays in the React app so intake + matter lifecycle
  lives in one place.
- **Content scripts are self-contained** (no ES module imports, MV3
  limitation). Popup and background service worker do use modules.
