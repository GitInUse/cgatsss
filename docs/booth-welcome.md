# Party-linked photo booth welcome (Step 2)

The main-site booth resolves a party through the existing shared code directory. A secure, HTTP-only `__Host-party-selection` cookie remembers only a public party locator for 12 hours. It is not a host login, verified guest identity, gallery grant, or permission to upload. The server resolves that locator and reads only the allowlisted party application's public `/api/photobooth/config` endpoint. It never forwards host, administration or visitor cookies.

The welcome screen displays the current party name and shared code. **Take Photo** opens the existing single-photo camera, with device-only download and no upload. **Enter Contest** opens the existing submission form only when guest submissions are allowed by the event's feature switch, schedule and upload mode. If enabled but currently unavailable, it explains why. If a feature is disabled, its option is hidden. If both are disabled, a message is displayed.

The existing `modules.enterContest` switch controls contest access; it is not duplicated. A new validated `settings.booth.takePhoto` boolean defaults to true for legacy events to preserve the available device-only camera. Both the host dashboard and wizard can change it. Unrelated settings saves preserve it, and Start Next Party copies it. No new database table or schema migration is needed for this step.

Switch Party, Finish, backgrounding and leaving clear captures. Stale context responses are ignored and canceled. Configuration is checked before starting a capture or opening contest entry and refreshed every 30 seconds while visible. An event change or Take Photo being disabled clears an active capture. The submission form identifies its expected event so a stale form cannot accidentally submit to the next party.

The Cloudflare page permits network requests only to its own origin. Its server-side integration uses an explicit party-domain allowlist, follows no upstream redirects, bounds responses and returns only public configuration. No personal fields or photo data are sent by the device-only booth. A sleeping free Render service produces a clear retry message rather than silently choosing another party.

Automated checks cover independent options, code selection, host-only and scheduled restrictions, disabled options, server failures, stale responses, event switching, capture cleanup, cookie separation, upstream credential stripping, settings persistence, wizard controls and existing voting/moderation. Physical Android, iPad/Safari and webcam testing still requires real devices.

This step does not add strips, collages, themes, Photo Fun uploads, party galleries, email delivery or photo expiration. The free Render sample remains temporary storage. Before real use, choose and verify durable storage and backup recovery. Further development requires separate approval.
