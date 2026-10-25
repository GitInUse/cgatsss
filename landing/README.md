# Main website

Cloudflare static assets serve the meme at / and the existing project homepage at /home. Party links open https://geech.idontthinkiwill.com/party/.

Deploy from the site-home branch, root directory landing, no build command, deploy command npx wrangler@4.152.0 deploy. The root-host-only route leaves all subdomains and email records alone. Existing proxied root DNS records remain in place beneath the Worker route, making routing rollback possible. No paid resources or private storage are used.

workers.dev and version preview URLs are disabled to avoid a personal-name hostname. Only files in public/ are published. No secrets, databases, or party uploads are included.

## Meme rotation and upload

The root page has no navigation and chooses a single random meme per load, avoiding the last selected URL in that browser. /home remains available by typing its address. /noupload accepts GIF, PNG, JPEG and WebP files up to 8 MB.

Uploads use the existing party server's host sign-in, with a separate Secure/HttpOnly/SameSite cookie on the root domain. Credentials are verified at geech.idontthinkiwill.com and are never placed in source. The free Render service may take a minute to wake during sign-in; browsing memes does not depend on Render. Restarting the party server requires signing in again.

NO_MEMES is a dedicated Cloudflare Workers KV namespace. Images persist across Worker updates and are public through /no-media/:id; direct writes require host sign-in and same-origin request checks. KV propagation and the catalogue cache can delay new rotation entries by a minute or two. The initial two images remain bundled as a fallback. On the Workers Free plan, KV has a 1 GB account allowance and operation limits; no paid subscription was activated. Keep original meme files locally as your backup.

Build command: npm run build (runs authentication, upload, persistence and rotation tests). Deploy command: npx wrangler@4.152.0 deploy.
