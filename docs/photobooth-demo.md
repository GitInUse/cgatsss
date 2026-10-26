# Camera-only photo booth proof of concept

Canonical public route: `https://idontthinkiwill.com/photobooth`, served by the existing Cloudflare Worker. It is independent of Geech, needs no event record or personal login, and does not add navigation to the public meme page. The old Geech demo route redirects here after the Cloudflare deployment is verified.

## Flow

Start camera -> optional 0/3/5 second countdown -> capture -> review -> Use this photo -> Download photo or Retake -> Finish / Next guest.

Camera permission is requested only after a user action. Audio is always false; the microphone is also disabled by the server Permissions Policy. After permission, devices may be selected if the browser reports more than one webcam. Frames are resized to fit within 1920 by 1920 pixels and encoded as JPEG. The live preview is mirrored; saved images are not mirrored so text remains readable.

This step does not create a guest session, upload a photo, enter a contest, send email, or associate a photo with an identity. Phone QR claiming, verified private galleries and server retention are later work.

## Privacy and cleanup

No camera starts on load or when returning to a backgrounded tab. Streams stop after capture, on Stop/Cancel, on disconnection, and when leaving or hiding the page. Unsaved images remain in browser memory as temporary object URLs. Retake, Finish, pagehide and backgrounding revoke these URLs, clear image/download elements, and zero canvas dimensions. Delayed permission grants and encoding callbacks are ignored after cancellation and any late-granted stream is stopped.

The page has no upload/API requests, analytics, or persistent browser photo storage. Its Content Security Policy explicitly sets connect-src to none. Download is exposed only after approval and saves a JPEG on the device according to browser behavior. Downloaded copies are NOT removed by Finish; shared-device operators must manage that downloads folder. The site does not claim to erase files the user already saved or memory controlled internally by the browser/OS.

The canonical standalone booth is public. The old party demo route remains unavailable outside demo/preview mode. No database migration, new dependency, hosting service or billing change is required.

## Verification

Automated simulated-media tests cover no automatic permission request, audio=false, frame resizing, approval before download, URL/canvas cleanup, countdown cancellation, delayed camera grants, delayed encoding, camera selection, retake, visibility changes, navigation, disconnection, unavailable or denied/busy cameras, disabled non-demo routes and restrictive response headers. Physical webcam, mobile Safari/Android camera and actual JPEG-download behavior still require manual device testing. The assistant has not accessed the user's webcam.


## Shared camera and entry attachment

`public/party/camera-controller.js` is the single camera controller. The standalone bootstrap uses its device-only download mode. The party entry form uses a prefixed instance with an approval callback that attaches a JPEG File to the existing multipart entry form; camera approval does not call the submission API. The form offers separate keyboard-accessible Upload Photo and Take Photo buttons. File selection no longer forces mobile camera capture. Leaving the entry view, locking Host mode, changing the current event, clearing the photo or leaving the page resets capture resources. Existing submission permissions, dates and module switches remain enforced by the server.

Run `node scripts/sync-photobooth.js` to generate the Cloudflare public controller/bootstrap/style copies from the canonical sources. Root and landing production checks reject stale copies. Deploy the Cloudflare branch first and verify `/photobooth`; only then publish the Render redirect and host attachment changes. Both deployments use existing free services. No schema, moderation, photo retention, invitation, party-gallery or voting-rule changes are included in Step 1.
