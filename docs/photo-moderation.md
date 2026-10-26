# Contest photo moderation (Step 2)

## Host and guest behavior

Host intake approves photos immediately. Guest intake creates a pending entry; the owner sees its status in **My Entries** and the host sees it in **Submitted Photos**. My Entries is tied to the existing private browser cookie, not an email account. Clearing cookies or switching devices does not transfer ownership. Host-submitted entries belong to the host browser until a later guest-identity phase.

The host can approve, hide, restore visibility, or permanently remove a photo after confirmation. Restoring a hidden pending photo does not approve it. Withdrawing is final for that entry in this release; records and ballots remain saved. Published winners must be unpublished before moderation or withdrawal.

Removing a photo leaves its entry ID, contestant details, category and votes intact and marks it Needs Replacement. Owners may replace requested photos while the event is live or voting remains open, including after entries close. Hosts can replace them after closing. Guest replacements need approval; host replacements are approved immediately. An owner's old ballot remains used, even when its selected entry is hidden or withdrawn.

This does not implement Photo Fun, email verification/delivery, gallery codes, invitations, multi-party isolation or scheduled photo expiration. The standalone booth remains device-only.

## Private API and storage

- `POST /api/host/entries/:id/moderation`: host-only; `{action: 'approve' | 'hide' | 'restore' | 'delete_photo', revision, confirm}`. Deletion requires `confirm: true`.
- `POST /api/entries/:id/replacement`: owner or host; multipart `photo` and `revision`. Rechecks authorization, state and deadline after image processing.
- `POST /api/entries/:id/withdraw`: owner or host; `{revision, confirm: true}`.
- `GET /api/my-entries`: current-event records for this browser only. State responses also include `myEntries`, status, revision and allowed owner actions.
- Public/host image URLs identify both entry and immutable filename. A stale filename can never resolve to a replacement. The old ID-only endpoint works only for the original `entry-id.jpg` file.
- Owners preview private photos through `/api/my-entries/:id/photo/:file`; other browsers cannot use those links. Withdrawn previews are blocked. No upload directory is publicly served.

Schema version 2 adds `approval` and `revision` to entries transactionally; legacy entries default to approved and keep their hidden flag. A blank `photo` represents a removed file. Moderation uses compare-and-swap revisions; ballots are never deleted or reassigned. Physical deletion is queued transactionally and retried on subsequent changes and startup. A file held by an in-progress export is deleted after that export closes. Previously downloaded backups and copies cannot be erased remotely.

## Backup and deployment

Before migration/deployment, download the host export and restore it into a **new** private directory:

```sh
node scripts/restore.js PRIVATE_EXPORT.zip NEW_PRIVATE_DIRECTORY
```

The new portable export has version 2 and retains approval/revision fields and records with removed photos. Version 1 exports remain readable and default to legacy approval. Full disaster-recovery backups still include the entire SQLite database and checksummed referenced photos. Removed photos are not included in newly created backups; older backups may contain them. The portable export does not contain host credentials or visitor/session tables; full backup is required for full credential/session/transition recovery.

Do not roll back the application alone to the old version after migration: older code uses positional entry inserts and lacks moderation checks. Prefer a forward fix; if restoration is required, use a verified pre-release backup in a separate location and explicitly plan the cutover. Never overwrite an existing data directory with either restore script.

Free Render storage remains temporary. A code deploy, sleep or restart can clear local data. Backups in that same service are not durable or offsite. This release adds no paid storage or billable resources.

## Verification

Tests cover approval privacy via state/photo/vote APIs, ownership, stale revisions, host automatic approval, hidden-state restoration, confirmed deletion, approved replacements with stable IDs/ballots, cutoff during processing, simultaneous replacements, expired host sessions, withdrawal, published-winner rules, schedule changes, v1/v2 backup compatibility, full restoration and restart persistence. The real page interaction test covers filter changes, cancellation, deletion, replacement attachment and approval.
