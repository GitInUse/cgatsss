# Render deployment preparation

Prepared locally. No push, deployment, paid service, or DNS change has been performed.

## Application and repository

- Repository: https://github.com/GitInUse/cgatsss — prepared Render branch `render-production` (not uploaded yet). The existing `main` branch has an active GitHub Pages deployment and stays unchanged during setup.
- Plain HTML/CSS/JavaScript frontend, Express 5 backend, Node 24.19.0, pnpm 11.25.0.
- Keep the existing server and all APIs. No Workers, D1, R2, external database, or WebSocket service is required. The frontend polls the API.
- Public files come only from `public/`. Private photos are served through authenticated/schedule-checked `/api/photos/:id`, not a static upload directory.
- `/party/` is the party application; `/` is the existing projects homepage.

## Before any deployment

1. Finish local build/tests and review `scripts/check-release.js` results.
2. Make a private full backup if you want to move the local preview's data. See [BACKUPS.md](BACKUPS.md). Code pushes never copy photos or databases automatically.
3. When publishing is approved, commit and push the latest complete source to a new `render-production` branch. Do not update `main`: its old static GitHub Pages deployment remains available during Render setup. Check for any additional Cloudflare build integrations before publishing. Leave DNS unchanged until Render is verified.
4. Check whether a Render service already exists. Reuse the intended service/disk; do not create duplicates, initialize a replacement database, detach a disk, or change `DATA_DIR` away from existing data.
5. Creating a paid service, attaching a disk, applying a Blueprint, and saving some environment changes can trigger deployment/billing. Stop before those actions until approved.

## Render dashboard settings (for the approved deployment later)

Connect Render's **GitHub provider** with access to this repository. Do not choose Static Site or deploy using only a public-repository URL; use a **Web Service** linked to the GitHub account so auto-deploy works.

| Setting | Value |
| --- | --- |
| Repository | `GitInUse/cgatsss` |
| Branch | `render-production` |
| Runtime | Node |
| Root directory | Blank — repository root |
| Instance | Starter; one instance only |
| Region | Oregon, unless reusing an existing service elsewhere |
| Build command | `corepack pnpm install --frozen-lockfile && corepack pnpm run build` |
| Start command | `node server.js` |
| Health check | `/healthz` |
| Persistent disk | `private-party-data`, mounted at `/var/data`, initially 1 GB |
| Auto-deploy | **After CI Checks Pass** once approved to go live |

`render.yaml` contains these settings for an optional Blueprint setup. Do not apply it just to inspect it: applying a Blueprint can create paid resources. Do not set a publish directory, Workers configuration, pre-deploy database command, or database-reset command. The disk is available only at runtime, so the build deliberately never opens it.

SQLite, private photos, host password hashes, and daily database backups live under the persistent disk. The server refuses production startup on Render without the configured mount. `DATA_DIR` can be a verified restored subdirectory of that disk. A disk-backed service supports one instance and has a short interruption during redeploys. Do not enable autoscaling or add a second writer.

## Environment variables

| Name | Value / handling |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.19.0`; also pinned in `.node-version` |
| `DATA_DIR` | `/var/data` for a new service; preserve the existing value if data already exists |
| `REQUIRE_PERSISTENT_DISK` | `true` |
| `PERSISTENT_DISK_PATH` | `/var/data` |
| `HOST_PASSWORD` | Set privately in Render, at least 12 characters. No production default. Never commit it. |
| `HOST_RECOVERY_CODE` | Set privately in Render, 8–128 characters. Required in production. Keep a separate private copy. Never commit it. |
| `PUBLIC_ORIGIN` | Initially omit or leave blank to use Render's automatic `RENDER_EXTERNAL_URL`. After the custom domain is verified, set `https://geech.idontthinkiwill.com`, without `/party/` or a trailing slash. |
| `PORT` | Let Render supply it. The server binds `0.0.0.0`. |

No Render API token, GitHub token, Cloudflare API token, or database password is required by the application. Render's GitHub integration handles source access. Do not paste secrets into chat or source control. Host password changes made in the app are stored as hashes on disk and take precedence over the initial `HOST_PASSWORD`; recovery remains separate. Restart/deploy invalidates host sessions but preserves contest data and saved password hashes.

## Verify Render before changing DNS

Use the **actual** HTTPS URL assigned in Render; do not assume its hostname from the service name.

1. Check `https://YOUR-SERVICE.onrender.com/healthz` returns `{"ok":true}`.
2. Check `/`, `/party/`, the logo, stylesheet, and script load. `/party` redirects to `/party/`.
3. Unlock Host mode; check settings, Archives, Hall of Fame, and recovery.
4. Use sample photos for a scheduled two-browser dry run: upload, enlarge, vote once per category, close, publish/unpublish a winner, and verify direct private photo links stop working outside the event window.
5. Download a portable export and create a full recovery backup. Perform a restore drill into a new directory.
6. Once a sample entry/settings exist, redeploy and confirm they survive on the same mounted disk. Do this before real party uploads.

Local production-mode tests cover the HTTPS routes, secure cookies, CSRF, canonical domain, private file access, and backup/restore. They do not prove a live Render deployment or DNS is working; live checks must wait until deployment is approved.

## Cloudflare: connect only `geech.idontthinkiwill.com`

Keep Cloudflare as the DNS provider. Do not change nameservers, the root `idontthinkiwill.com` website, email records, `limitedrun.net`, or unrelated services.

1. After Render is working, open the service's **Settings → Custom Domains → Add Custom Domain** and add `geech.idontthinkiwill.com`.
2. In Cloudflare select `idontthinkiwill.com` → **DNS → Records**. Record the existing `geech` entry/target so it can be restored if needed.
3. Change **only the conflicting `geech` website record** to:

   | Type | Name | Target | Proxy | TTL |
   | --- | --- | --- | --- | --- |
   | CNAME | `geech` | actual Render hostname, such as `YOUR-SERVICE.onrender.com` | **DNS only** (gray cloud) | Auto |

   No `https://` or path goes in Target. Resolve conflicting A/AAAA/CNAME records for this hostname only; leave other DNS entries intact. If Cloudflare Pages/Workers owns this hostname as a custom domain/route, remove that conflicting hostname mapping at the approved cutover, not the whole project.
4. In Render click **Verify** and wait for the TLS certificate to be valid. Leave Cloudflare DNS-only for the simplest setup. Cloudflare remains the DNS provider even with the proxy off.
5. Set Render `PUBLIC_ORIGIN=https://geech.idontthinkiwill.com`, save/redeploy, and test the custom URL, login, QR code, and `/party/`.
6. The app redirects other website hostnames to this canonical domain. `/healthz` stays usable for Render's internal health checks.

The final party URL is **https://geech.idontthinkiwill.com/party/**. The old website is not updated by refreshing while its DNS still points to the old host.

If enabling Cloudflare's proxy later, first verify Render's certificate, use Full (strict) TLS, and bypass caching for `/api/*` and private responses. Do not add “Cache Everything” rules over the app. DNS-only needs no Cloudflare proxy/TLS-mode changes.

## Future updates

The included GitHub workflow runs the production build and tests for `main` and `render-production` pushes and pull requests. After publishing is approved, choose **After CI Checks Pass** in Render and link `render-production`. Future approved pushes to `render-production` automatically rebuild and redeploy this same service. They do not recreate the disk or copy local data over it. Deploy when the party is not live because the disk-backed service briefly restarts. Retiring the old GitHub Pages deployment is a separate cutover action; do not merge the new layout into `main` during setup.

## Official references

- [Render Blueprint settings](https://render.com/docs/blueprint-spec)
- [Persistent disks and their limitations](https://render.com/docs/disks)
- [GitHub automatic deployments](https://render.com/docs/deploys)
- [Cloudflare DNS with Render](https://render.com/docs/configure-cloudflare-dns)
