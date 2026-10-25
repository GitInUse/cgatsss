# Main website

Cloudflare static assets serve the meme at / and the existing project homepage at /home. Party links open https://geech.idontthinkiwill.com/party/.

Deploy from the site-home branch, root directory landing, no build command, deploy command npx wrangler@4.152.0 deploy. The root-host-only route leaves all subdomains and email records alone. Existing proxied root DNS records remain in place beneath the Worker route, making routing rollback possible. No paid resources or private storage are used.

workers.dev and version preview URLs are disabled to avoid a personal-name hostname. Only files in public/ are published. No secrets, databases, or party uploads are included.
