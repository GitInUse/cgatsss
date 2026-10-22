# idontthinkiwill.com — Geech's party app

An existing full-stack costume contest: plain HTML/CSS/JavaScript, Express 5, SQLite, and private photos on disk. The party app is at `/party/`; `/` is the projects homepage. No replacement app or Cloudflare storage migration is used.

## Deployment status

Render configuration is prepared locally. No deployment, paid resource activation, Git push, or DNS change has been performed. The intended party address is **https://geech.idontthinkiwill.com/party/** after the owner approves deployment and domain cutover.

- [Exact Render dashboard, secrets, GitHub auto-deploy, and Cloudflare DNS steps](docs/RENDER-SETUP.md)
- [Full and portable backups, restore drills, and safe local-data migration](docs/BACKUPS.md)

## Local development and checks

Use the pinned Node **24.19.0** and pnpm **11.25.0**:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm test
```

The build validates JavaScript, native runtime dependencies, generated HTML/CSS, public assets, and release exclusions. It does not open the live database, overwrite photos, or seed data. Tests create isolated temporary databases.

For the local preview, double-click **Start Party Preview.cmd**, or run `node scripts/preview.js`. This explicit local-only entrypoint retains the requested short default PIN and the ignored private recovery-code file. Those defaults are not enabled by production startup.

For ordinary local server use, copy `.env.example` to a private `.env`, set a unique host password, and run `node --env-file=.env server.js`. Production starts with `node server.js`, listens on Render's `PORT` at `0.0.0.0`, and requires private host password/recovery secrets. Render data must be on its mounted persistent disk.

After editing the original-layout generator or theme, regenerate with `node scripts/restore-layout.js` before building. Generated assets are checked in and verified without rewriting them at build time. `docs/original-prototype.html` is a historical layout reference, not the served application.

## Preserved behavior

- Guests with the link can upload and vote within the host's schedule. All party times use Central Time with daylight-saving handling.
- One vote per browser/category/party is enforced by SQLite. Browser identity is cookie-based, not account identity; clearing cookies or changing browsers can bypass this casual-party voting limit.
- Outside event hours, only explicitly published winners remain public. Other photos and yearly archives are host-only, including direct photo URLs. Already saved photos/screenshots cannot be recalled.
- Uploads accept JPEG/PNG/WebP up to 8 MB and 40 megapixels, are re-encoded without metadata, and stay outside `public/` and Git. There are no third-party scripts, fonts, analytics, or QR providers on guest pages.
- Host password changes persist on disk, while recovery stays separate. Deployment/restart invalidates host sessions, not stored contest data.
- Categories can be corrected by the host before votes/publication. After voting they stay fixed to preserve ballots.
- Starting the next party copies categories/tagline/upload mode, requests new dates and confirmation, and archives the old party. Undo is available until new activity; it restores the previous party as closed.
- Historical Hall of Fame records start private, can be edited, and require a separate publication confirmation. They do not fabricate live votes.
- Portable photo exports and complete private recovery backups are available. Restores write only to new directories, never over existing data.

Keep one Render instance and the same persistent disk. Builds and auto-deploys never restore, reset, or replace data. The photo cap is roughly 650 MB; monitor total disk usage, including database snapshots. Keep a tested offsite backup.

## GitHub publishing

The checkout belongs to **GitInUse/cgatsss**. Its existing **main** branch has an active GitHub Pages deployment. The prepared Render configuration uses a separate **render-production** branch so the old site can remain unchanged during setup; that branch has not been uploaded yet. The workflow in `.github/workflows/ci.yml` runs build/tests without production secrets. Once publishing is approved and Render is linked to **render-production** with **After CI Checks Pass**, future approved pushes to that branch update the same service. Cloudflare remains the DNS provider; only the `geech` subdomain is part of this cutover. The root domain, email records, and `limitedrun.net` are left alone.
