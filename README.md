# Wave Bot

Wave Bot is the review dashboard for fairlife Arizona wave operations. Prepare a workbook from SharePoint and OpenDock, review it, then approve it or upload a replacement. Once connected to the production backend, the dashboard records decisions and displays Blue Yonder results.

## Run locally

Use Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

## Publish to GitHub Pages

Push the source to your repository on `main`. In **Settings → Pages**, select **GitHub Actions**. The included **Publish Wave Bot** workflow builds and publishes the website.

To build manually:

```sh
npm run build
```

The complete HTML, CSS, and JavaScript are written to `dist-pages`. To publish without a build step, upload the contents of that folder to a repository and choose **Deploy from a branch**, `main`, `/ (root)` in Pages settings. Relative asset paths support both repository pages and custom domains.

## Workspace connection

The GitHub Pages website connects to the existing n8n API. No local server is required.

The current release supports **file preparation**: select **Prepare file** to generate a workbook from SharePoint and OpenDock. The workbook appears in the review queue for preview and download. It stops there; approval, replacement uploads, and Blue Yonder processing remain paused. Connecting and refreshing only send the `list` and `detail` actions.

### Private access key

Enter the private Wave Bot key supplied separately by the workspace administrator. The website holds it in memory for the current tab, sends it only to the configured Wave Bot endpoint over HTTPS, and clears it when you disconnect or reload. Rejected or expired credentials disconnect the dashboard and clear its displayed data.

Never place the key in repository files, GitHub Pages settings, URLs, build variables, or screenshots. Public configuration contains the endpoint address and display mode only.

| Setting            | Purpose                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `apiUrl`           | Existing Wave Bot HTTPS endpoint.                                                         |
| `authMode`         | `access-key` uses the API's existing bearer authentication.                               |
| `readOnly`         | Defaults to `true`; keeps approval and production controls disabled.                      |
| `allowPreparation` | Defaults to `false`; when `true`, permits file preparation while production stays paused. |

The shared website key identifies a workspace operator, not an individually verified employee. The API permits this key to read files and prepare a workbook; it rejects approvals and replacement uploads. Frontend settings control the interface, while n8n enforces the website key's permitted actions. The existing local server connection is maintained separately. Before opening production approval to a wider team, use verified individual accounts and server-enforced roles.

The existing optional `session` mode supports a separately hosted sign-in service with `sessionUrl` and `signInUrl`. Its session endpoint returns `{ "user": { "displayName": "...", "email": "..." } }`. That service must authorize each operation and set the recorded reviewer from its verified session. Update the HTML content security policy when configuring a different service origin.

The n8n endpoint must allow the exact GitHub Pages origin and the `Authorization` and `Content-Type` headers. The file preparation branch finishes by saving the generated workbook for approval; it does not enter the Blue Yonder branch.

### Review endpoint

`POST apiUrl` accepts JSON with an `action`:

- `list`: return the latest runs in `runs`.
- `detail`: accept `runId` and return the full record in `run`. With `download: true`, include the workbook as `fileBase64` and its `downloadName`. `original: true` selects the original file.
- `generate`: prepare a new workbook and return its `runId`. The file waits for approval.
- `approve`: accept `runId`, atomically approve a pending file, and begin processing.
- `reject`: accept `runId` and `reason`, record the rejection, and wait for a replacement.
- `upload`: accept `runId`, `fileName`, `fileBase64`, and `sheetName`. Validate the replacement before accepting it for production.

The `Run` and `ApiResponse` types in `app/wave-desk.tsx` describe the expected data. Failed requests return a suitable HTTP status and an `error` message. Duplicate approvals must be rejected by the backend.

## Dashboard data

- Totals cover the latest 100 runs.
- Charts use the selected workbook's actual rows. Cancelled appointments remain visible in the mix and are excluded from active schedules and carrier counts. Missing appointment times are reported separately.
- A rejected workbook waits for a replacement. Both file versions and decisions remain in run history.
- Replacement files accept `.xlsx`, up to 2 MB and 1,000 rows; validation is enforced by the backend.
- Results show the recorded shipment, load, appointment, and wave outcomes, including warnings and skipped rows.
- Active runs refresh every 45 seconds and idle history every five minutes. All appointment times use Phoenix time.

## Checks

```sh
npm run check
npm test
npm run build
```
