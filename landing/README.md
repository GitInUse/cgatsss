# Main website — Phase 2 / Sign in with Google

The public root remains the single-image No meme page: no navigation, no authentication. All bundled images and image: records in NO_MEMES remain intact. Geech stays at https://geech.idontthinkiwill.com/party/ with its separate host login.

## Sign-in and billing choices

The private dashboard and uploader use ordinary Google OpenID Connect sign-in. Cloudflare Zero Trust was cancelled and must not be reactivated. The Google project is only for OAuth credentials, with billing disabled: no trial, payment method, paid Identity Platform/Firebase plan, paid API, server or database is required.

Google verifies the owner and manages phone/passkey/authenticator checks and Google-account recovery. The website requests only openid and email, not Gmail, Drive, contacts or files. It does not collect Google passwords or store access/refresh tokens. Google may request its own password depending on the owner's Google account settings; the website itself has no password.

The prior request for a website reset from either inbox is replaced by Google-managed recovery. A Zoho address can be the Google account's recovery email. An alternate email can sign in directly only if it belongs to an approved Google account. The website does not reveal approved-address hints; Google controls its own account chooser and recovery screens.

## Maintained authentication libraries

openid-client 6.8.8 is an OpenID-certified, MIT-licensed implementation of OAuth/OIDC. jose 6.2.13 supplies standard encrypted transaction cookies. oauth4webapi 3.8.8 is their only additional runtime dependency. Versions and integrity hashes are frozen in landing/pnpm-lock.yaml. Install scripts are disabled. Check the dependency audit before release.

The flow uses authorization code + PKCE S256 + state + nonce. The library validates ID-token signatures, issuer, audience, expiry and nonce; the Worker also requires a verified email and checks the private owner allowlist. Google endpoints are fixed and HTTPS-only. Transactions expire after 10 minutes. Authorization codes cannot be redeemed twice.

Authenticated sessions use random 256-bit opaque cookie tokens, with only token hashes stored under auth-session: in NO_MEMES. The cookie is Secure, HttpOnly, SameSite=Lax, host-only, path /, and lasts 12 hours. Same-origin plus custom-header checks protect uploads and logout. Logout deletes the server session and clears cookies. A Google client-secret or allowlist change invalidates old sessions.

Workers KV is eventually consistent. A deleted/copied session token might briefly remain usable in another Cloudflare location until deletion propagates. The local browser cookie clears immediately; session expiry is enforced by the Worker. No automatic offsite backup of auth sessions is required; sign in again after loss. Meme originals should still be backed up locally.

## Runtime configuration

Set these on Cloudflare Worker idontthinkiwill-home:
- GOOGLE_CLIENT_ID: the public web OAuth client ID is pinned in wrangler.jsonc, so deployments preserve it. This identifier is not an API key or secret.
- GOOGLE_CLIENT_SECRET: the Google-generated client secret (**Secret**). The owner should copy it directly from Google into Cloudflare, never into chat, GitHub, or source.
- OWNER_EMAILS: a **Secret**, JSON array containing one or two approved Google-account email addresses. Keep values private; examples must never contain real addresses.
- LOGIN_LIMITER: native Workers binding, 10 attempts per minute per Cloudflare location for each start/callback key (approximate protection).
- NO_MEMES: keep the existing namespace and binding.

DASHBOARD_PASSWORD, TEAM_DOMAIN and POLICY_AUD are not used. Previously configured secrets can be removed privately after the new flow works, without reading or copying their values.

## Google setup

Use the dedicated IDontThinkIWill Login project, stone-cathode-512720-s8 (created without billing; the Billing page confirms no linked billing account). Do not enable a free trial or connect a billing account.
1. Configure Google Auth Platform branding and an External audience for this personal Gmail account. Basic login needs only openid and email scopes. Keep access restricted to the owner's test users initially, with the Worker allowlist always enforced.
2. Use idontthinkiwill-support@googlegroups.com for support and project notifications. The owner created this Google Group; it has one member, owner-only conversation/member visibility, invitation-only joining, and incoming mail permitted. Subscription is Each email, forwarding messages to the owner without publishing the private membership address. Do not replace it with a login/recovery address.
3. Finish the branding wizard only after the owner accepts the Google API Services User Data Policy. Create an OAuth client of type Web application. The owner must complete credential creation/secret handling.
4. Authorized redirect URI: https://idontthinkiwill.com/api/personal/google/callback (exactly; no trailing slash).
5. App home URL: https://idontthinkiwill.com/home. Privacy policy: https://idontthinkiwill.com/privacy. Authorized domain: idontthinkiwill.com, if Google asks.
6. Put the generated client ID and private secret into the Worker settings, along with the owner allowlist. Do not send any credential in chat.
7. Before publishing to GitHub, confirm no billing account is linked. After publishing, the owner must complete Google sign-in and test phone/passkey/recovery settings themselves.

No code creates cloud billing accounts or activates paid products.

## Protected routes

/home, /home.html, /home/ and /noupload aliases are rendered by the Worker only after server-side session validation. HTML is bundled outside public/, so static file requests cannot bypass authentication. Private responses are no-store/noindex, with a same-origin CSP and frame protection. /login shows a generic Google button without owner email hints.

GET /api/personal/google/start begins OAuth; GET /api/personal/google/callback verifies Google's response; GET /api/personal/session reports session status without personal data; POST /api/personal/logout ends this website session. Legacy local-password and party-auth uploader login endpoints are retired.

POST /api/no-admin/upload still requires a private session, same-origin request and X-No-Upload header. GIF/PNG/JPEG/WebP support, 8 MB size limits and signature checks remain. GET /api/no-memes and /no-media/:id stay public. Only image: keys enter the rotation, never session records.

## Build, deployment, and validation

GitHub GitInUse/cgatsss, site-home branch; Cloudflare root landing.
Build: pnpm --ignore-workspace install --frozen-lockfile --ignore-scripts && npm run build
Deploy: npx wrangler@4.152.0 deploy

The standalone lockfile leaves the party application's root dependencies untouched. Keep the root-domain route, disabled workers.dev/previews, existing KV namespace and Workers Free plan. Do not publish before real Google configuration is ready; missing configuration fails closed for private pages.

Tests exercise the real OIDC library against a simulated Google discovery/token/key server with real RSA signatures and PKCE. They cover approved/rejected accounts, nonce/state/expiry/signature/audience/issuer checks, authorization-code reuse, encrypted-cookie tampering, shared sessions, revocation, old host-cookie rejection, no hints, private aliases, uploads, persistence and unchanged random rotation.

After live deployment: signed-out private URLs must ask for Google sign-in; one sign-in opens dashboard and uploader; upload a real meme; log out and confirm access is blocked; verify the public root and Geech remain available.

Only Phase 2: dashboard has the existing Geech link, meme uploader, future-project space and logout. Party creation, multi-party storage and paid infrastructure await separate approval.

The first generated Google client secret appeared in browser accessibility output during setup. It was never used by the website or committed. The owner must generate a replacement in Google, enter only the replacement in Cloudflare, and disable the older secret before publication. Do not copy either value into setup notes, logs or chat.

### Meme library
The private uploader lists all starter and uploaded memes. Delete confirms removal from public rotation; Restore reverses it. Files are retained, and existing direct image links still work. Deletion markers persist in the same KV namespace. Propagation can take a minute or more. Removing every meme leaves the public page empty rather than bringing starter memes back.
