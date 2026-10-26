# Camera-only photo booth proof of concept

Route: `/party/photobooth-demo/`. Available only in the existing demo mode or explicit non-production local preview, with a link on the party Info page. No event record is needed to open this standalone demo.

## Flow

Start camera -> optional 0/3/5 second countdown -> capture -> review -> Use this photo -> Download photo or Retake -> Finish / Next guest.

Camera permission is requested only after a user action. Audio is always false; the microphone is also disabled by the server Permissions Policy. After permission, devices may be selected if the browser reports more than one webcam. Frames are resized to fit within 1920 by 1920 pixels and encoded as JPEG. The live preview is mirrored; saved images are not mirrored so text remains readable.

This step does not create a guest session, upload a photo, enter a contest, send email, or associate a photo with an identity. Phone QR claiming, verified private galleries and server retention are later work.

## Privacy and cleanup

No camera starts on load or when returning to a backgrounded tab. Streams stop after capture, on Stop/Cancel, on disconnection, and when leaving or hiding the page. Unsaved images remain in browser memory as temporary object URLs. Retake, Finish, pagehide and backgrounding revoke these URLs, clear image/download elements, and zero canvas dimensions. Delayed permission grants and encoding callbacks are ignored after cancellation and any late-granted stream is stopped.

The page has no upload/API requests, analytics, or persistent browser photo storage. Its Content Security Policy explicitly sets connect-src to none. Download is exposed only after approval and saves a JPEG on the device according to browser behavior. Downloaded copies are NOT removed by Finish; shared-device operators must manage that downloads folder. The site does not claim to erase files the user already saved or memory controlled internally by the browser/OS.

Normal production does not expose the demo route. No database migration, new dependency, hosting service or billing change is required.

## Verification

Automated simulated-media tests cover no automatic permission request, audio=false, frame resizing, approval before download, URL/canvas cleanup, countdown cancellation, delayed camera grants, delayed encoding, camera selection, retake, visibility changes, navigation, disconnection, unavailable or denied/busy cameras, disabled non-demo routes and restrictive response headers. Physical webcam, mobile Safari/Android camera and actual JPEG-download behavior still require manual device testing. The assistant has not accessed the user's webcam.
