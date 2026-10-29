# Deal Hunter operations

The existing Cloudflare Worker `idontthinkiwill-home`, branch `site-home`, root `landing`, owns this feature. The Render party app is unchanged.

## What is connected

- Existing Google owner login protects `/deals`, its aliases and `/api/personal/deals*`.
- Two public Slickdeals RSS feeds: Frontpage and newest Pokémon titles.
- A 15-minute Cloudflare Cron Trigger calls `scheduledDeals`.
- The owner can request a source check from the dashboard (five-minute cooldown). Refresh only reloads saved data.
- Compact 76-pixel cards with source images when supplied, retailer links, source attribution, reported price and coupon conditions.
- No inferred typical prices, savings percentages, star ratings, local inventory or verified checkout claims.
- A PWA manifest, icons and a service worker for push. Private pages and API responses are never cached by the service worker.

## Storage and notifications

All records use the existing NO_MEMES KV binding with a `deal-hunter:` prefix. Meme/session keys are unchanged. Never expose or copy push keys or browser subscription records.

- `deal-hunter:catalog:v1`: at most 100 reports, discovery/check timestamps, source status and up to 20 distinct reported price observations per product. Missing reports become stale; they are not falsely marked expired. Source failures preserve saved data and are displayed. Reports older than a day are hidden as stale even when sources fail.
- `deal-hunter:vapid:v1`: server-generated Web Push key pair, created during the first source check. Only the public key is returned through the authenticated API. Do not delete this record after subscribing devices: doing so requires re-subscribing all devices.
- `deal-hunter:push:v1:<endpoint hash>`: up to 10 private device subscriptions, settings and up to 150 alert entries per device. The push endpoint allowlist covers Chrome/Android, Firefox and Safari services; redirects are not followed.

Notifications are disabled until the owner explicitly enables them on a device. Routine reports never trigger push. Pricing-glitch and drawing reports are urgent; other reports qualify only with at least 100 community votes and a relevant category. Each scan sends at most one eligible alert per device. An unchanged product is suppressed; a further reported price reduction of at least 15% can re-alert. Only new reports since device registration, checked recently and published within an hour, qualify. These are community reports, never claimed as verified retail stock or savings. HTTP 404/410 removes expired subscriptions; other failures remain retryable. A successful push-service response is acceptance, not proof Android displayed the notification.

KV is eventually consistent. Subscribing/saving settings can take a minute to propagate. Concurrent scans can theoretically duplicate an alert; this is best-effort deduplication, not an exactly-once queue. The source-check button has a five-minute cooldown and a native rate limit. Do not replace Google auth, change the KV namespace, activate paid Workers plans or provision paid providers to address this without owner approval.

## Samsung setup and verification

1. In Chrome on the Samsung, sign into `https://idontthinkiwill.com/deals`.
2. Open Chrome's menu → Add to Home screen → Install.
3. Open Notifications & installation, choose categories, tap Enable notifications, and allow Chrome's prompt.
4. Tap Send test notification. Check the Android notification tray, then tap it and verify `/deals` opens. A later deal alert links to the corresponding card.
5. If blocked, review Chrome site notification permission and Android's Chrome notification/battery settings. Delivery while closed depends on the browser/OS.

A source check initializes the push key. If push setup is pending, check sources, wait for KV propagation, and refresh. Never put credentials into chat or GitHub.

## Coverage still missing

This is an operational community-feed application, not complete direct retailer coverage.

- Keepa/Amazon historical selling-price verification requires an authorized data-provider API credential. Keepa may require a paid subscription; obtain owner approval before subscribing.
- Best Buy store-specific open-box inventory for ZIPs 60193 and 60107 requires appropriate developer/partner API access. Never infer pickup availability from national listings.
- ShopSimon and other retailer-specific collectors require documented permitted feeds/APIs or explicit access. Community reports may mention those stores; that does not mean every store is monitored.
- Direct Walmart drawing-window and Target product monitoring, Pokémon Center/GameStop/etc. inventory monitoring, and complete 30th Celebration coverage are not implemented. Preserve the existing separate Pokémon/shopping automation.
- Samsung installation and real-device push receipt require the owner's phone test.

The active ChatGPT shopping automation and separate vinyl monitor were not accessed or changed.

## Build and deploy

Use the existing Cloudflare GitHub integration. Production branch: `site-home`; root: `landing`; build: `pnpm --ignore-workspace install --frozen-lockfile --ignore-scripts && npm run build`; deploy: `npx wrangler@4.152.0 deploy`.

Tests: `node --test landing/test-worker.mjs landing/test-deals.mjs` and root `node --test test/*.test.js`. The landing build also checks shared photo booth synchronization. Root production build: `node scripts/build.js`.

Verify the Cloudflare deployment reaches Ready at 100%, then verify the live signed-out redirect and API 401, real Google sign-in, `/home` navigation, source collection, images, filters, notification registration/test, and public meme/party functionality. Cron Trigger changes may take several minutes to propagate. Look at catalog timestamps and source statuses; all-source failure throws a scheduled event error and does not claim a successful scan.

Cloudflare Free CPU/subrequest/KV quotas still apply. No paid plan is provisioned by this code. Feed/provider failure is visible in the dashboard. Do not silently describe degraded monitoring as healthy.
