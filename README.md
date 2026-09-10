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

## Connect your backend

This package contains the website frontend. Authentication and production operations require a separately hosted backend. Until it is configured, the site displays a connection notice and disables production controls.

Set the public addresses in `public/wave-bot.config.json`, then rebuild. For an already-built site, edit `dist-pages/wave-bot.config.json` directly.

| Setting | Purpose |
| --- | --- |
| `apiUrl` | HTTPS backend endpoint for review actions. |
| `sessionUrl` | HTTPS endpoint for the signed-in user's session. |
| `signInUrl` | Your sign-in page, configured to return to this website. |

These settings contain addresses only. Keep passwords and n8n credentials on the backend. Do not point the frontend directly at a webhook that requires a shared secret.

The frontend sends authenticated requests using cookies. The backend must validate the session, authorize each operation, allow the exact website origin, and support the chosen authentication method in your team's browsers. Each recorded reviewer must come from the verified backend session rather than a client-supplied name.

### Session endpoint

`GET sessionUrl` returns:

```json
{
  "user": {
    "displayName": "Reviewer",
    "email": "reviewer@example.com"
  }
}
```

Unauthenticated or unauthorized requests return `401` or `403`.

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
npm run test:metrics
npm run build
```
