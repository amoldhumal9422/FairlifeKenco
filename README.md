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

The current release supports **production runs**. Select **Prepare file** to generate a workbook from SharePoint and OpenDock. Review the workbook, then choose **Approve & run** and confirm to start Blue Yonder processing. Choose **Reject** to record a reason and provide a replacement workbook; **Upload & run replacement** validates and starts that file. Connecting, refreshing, previewing, and downloading do not start production.

### Private access key

Enter the private Wave Bot key supplied separately by the workspace administrator. The website holds it in memory for the current tab, sends it only to the configured Wave Bot endpoint over HTTPS, and clears it when you disconnect or reload. Rejected or expired credentials disconnect the dashboard and clear its displayed data.

Never place the key in repository files, GitHub Pages settings, URLs, build variables, or screenshots. Public configuration contains the endpoint address and display mode only.

| Setting            | Purpose                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `apiUrl`           | Existing Wave Bot HTTPS endpoint.                                                                  |
| `authMode`         | `access-key` uses the API's existing bearer authentication.                                        |
| `readOnly`         | Defaults to `true`; this deployment sets it to `false` to enable approval and production controls. |
| `allowPreparation` | Defaults to `false`; when `true`, permits file preparation while production stays paused.          |

The shared website key identifies a workspace operator, not an individually verified employee. The API permits file preparation, review decisions, and replacement uploads for this key. Frontend settings control the interface, while n8n authenticates requests and validates the file and run state before processing. The existing local server connection is maintained separately. Share the key only with people authorized to approve production runs.

The existing optional `session` mode supports a separately hosted sign-in service with `sessionUrl` and `signInUrl`. Its session endpoint returns `{ "user": { "displayName": "...", "email": "..." } }`. That service must authorize each operation and set the recorded reviewer from its verified session. Update the HTML content security policy when configuring a different service origin.

The n8n endpoint must allow the exact GitHub Pages origin and the `Authorization` and `Content-Type` headers. File preparation finishes by saving the generated workbook for approval. A confirmed approval or an accepted replacement enters the existing Blue Yonder branch; a rejection waits for a replacement.

### Review endpoint

`POST apiUrl` accepts JSON with an `action`:

- `list`: return the latest runs in `runs`.
- `detail`: accept `runId` and return the full record in `run`. With `download: true`, include the workbook as `fileBase64` and its `downloadName`. `original: true` selects the original file.
- `generate`: prepare a new workbook and return its `runId`. The file waits for approval.
- `approve`: accept `runId`, atomically approve a pending file, and begin processing.
- `reject`: accept `runId` and `reason`, record the rejection, and wait for a replacement.
- `upload`: accept `runId`, `fileName`, `fileBase64`, and `sheetName`. Validate the replacement before accepting it for production.
- `repair`: accept `runId`, the original result's `rowIndex`, `load`, `expectedUpdatedAt`, a UUID `repairId`, and `confirm: true`. The authenticated backend validates the saved conflict and appointment date, claims the run, and returns `202` before inspecting Blue Yonder. Like workbook approval, it accepts today's Arizona date or a future date. Client-supplied times and request URLs are not used.

The `Run` and `ApiResponse` types in `app/wave-desk.tsx` describe the expected data. Failed requests return a suitable HTTP status and an `error` message. Duplicate approvals must be rejected by the backend.

## Dashboard data

- Totals cover the latest 100 runs.
- Charts use the selected workbook's actual rows. Cancelled appointments remain visible in the mix and are excluded from active schedules and carrier counts. Missing appointment times are reported separately.
- A rejected workbook waits for a replacement. Both file versions and decisions remain in run history.
- Replacement files accept `.xlsx`, up to 2 MB and 1,000 rows; validation is enforced by the backend.
- Results show the recorded shipment, load, appointment, and wave outcomes, including warnings and skipped rows.
- **Appointments to verify** lists loads blocked by an existing appointment and exports a separate CSV. New runs record the previous appointment, linked wave, allocation assessment, and actions taken. Older runs show unavailable audit details as **Not recorded**.
- Ordinary appointment conflicts stop before wave creation and use read-only lookups. **Repair appointment** is a separate, confirmed production action for one outbound AZ02 load. It rechecks wave ownership, allocation, empty picks and the original appointment. A single eligible unallocated wave is deleted, followed by the old appointment; a replacement appointment is then created at the saved time and verified. The action does not recreate the wave or rerun the workbook. An appointment that already matches is left unchanged.
- Allocated, active or shared waves, recurring or checked-in appointments, missing allocation evidence, and changed assignments stop for review. The repair uses an exclusive server-side lock and saves its audit before every request. A failed or uncertain write is not retried automatically. Review every repaired load manually, including successful repairs.
- Run results retain their original production totals. Repair history, original and replacement appointment IDs, allocation checks, and confirmed actions are recorded separately and sent in a repair email.
- Active runs refresh every 45 seconds and idle history every five minutes. All appointment times use Phoenix time.

## Checks

```sh
npm run check
npm test
npm run build
```

The repair engine in `workflow/appointment-repair.js` is embedded in the n8n Code nodes. Its automated tests use simulated responses with no network calls. The production repair path has not been executed for testing.

If a repair is interrupted or a write cannot be confirmed, its run is marked **Repair needs review** and the `fairlife_appointment_repair_lock` stays held. An administrator must inspect the execution, load, wave, and appointment before clearing that lock. Do not use n8n's retry command on an execution that reached a write: it could repeat a production request. A repaired row remains unavailable for another website repair until it has been reviewed; no automatic rollback is attempted.
