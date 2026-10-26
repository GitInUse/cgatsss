# Self-service guest sign-in proof of concept

## Scope

The guest sign-in simulator is available at `/party/guest-demo/` only when the existing `DEMO_MODE=true` setting is enabled or when `createApp` is explicitly started with a non-production local preview. The party Info page links to it only in that mode and when a current event exists. Normal production returns 404 and does not create demo tables. No dependencies, email service, subscriptions, or paid resources were added.

This is a standalone identity-flow demonstration. It does not change visitor-based voting, host authentication, Google dashboard authentication, entry ownership, or photo permissions. All responses identify these guests as `demo-only` with `emailVerified: false`. The photo booth and phone-claiming flow are future steps, not implemented here.

## Guest experience

1. Enter a made-up display name and an address ending in `@example.test`.
2. View a simulated inbox. No message is sent. Real email domains are rejected by the server.
3. Open the displayed demo email link and confirm demo verification.
4. See the private event-specific demo session, change the display name, or finish/switch guest.
5. Returning through a new simulated message for the same event and fictional address finds the same demo identity. Merely starting a new link does not overwrite an existing name.

The link is single-use, expires in ten minutes, and is bound to the requesting browser visitor and event. This simulator does not support real cross-device email verification. Its token is placed in the URL fragment and removed by the page before any API verification request. Link and session tokens are stored as SHA-256 hashes. Simulated inbox content is visible only in the requesting browser.

## Storage and boundaries

Only additive `CREATE TABLE IF NOT EXISTS` statements are used:

- `demo_guests`: ID, event ID, fictional email, display name, creation time; unique event/email pair.
- `demo_guest_links`: token hash, event, requesting visitor, pending details, expiry.
- `demo_guest_sessions`: opaque token hash, event/guest, requesting visitor, expiry.

No existing event records are rewritten. Old SQLite databases need no destructive migration. These tables are initialized only when the demo is enabled. The existing full SQLite backup includes them; the portable party/photo export deliberately continues to omit these disposable demo identities. Normal party export/restore behavior is unchanged.

Sessions expire after one hour. Cookies are HttpOnly and SameSite=Lax, with Secure in production. Requests use the existing same-origin/CSRF protection. Session lookup checks visitor binding, expiry and the current event on every request. There is no public guest list, guest-ID lookup route or arbitrary guest-edit endpoint. Registration and verification are rate limited; each event has a 1,000-demo-identity cap. Expired links/sessions are pruned on subsequent registrations; identity rows remain until the demo database is reset. No automatic real-photo retention policy is introduced.

Finish revokes the session and pending links on the server and clears the screen immediately. Failed network sign-out leaves personal fields hidden and asks for a retry; back navigation does not restore the old guest screen. Tabs recheck sessions when returning to the page. A separate browser cannot redeem a copied link or use a copied demo cookie without the original visitor cookie.

## Checks

Automated tests cover fictional-address restrictions, hash storage, one-time redemption, expiry, resend invalidation, cancellation, same-event returning identities, name editing, restart persistence, guest switching, offline sign-out, event isolation, ordinary-production disablement, rate limits, and denial of host/private-photo access. Existing voting and Google-login regression tests remain in the suite.

No automated test is evidence of a live-data backup or successful testing on real iPads/phones. The attempted in-app browser check of the isolated local preview timed out; visual and cross-device checks remain pending.
