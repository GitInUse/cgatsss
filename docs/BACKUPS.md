# Private backups and non-destructive restore

Backups contain private photos and contest data. Keep them outside GitHub, `public/`, and public file-sharing links. Full backups also contain password hashes and visitor/session records; treat them as sensitive. Recovery codes and initial passwords configured in Render remain environment secrets and are not part of these archives.

## Three backup layers

1. **Daily database snapshots:** production startup/hourly checks create one consistent SQLite snapshot per UTC day in `DATA_DIR/backups`, keeping 14 days. New snapshots are completed under a temporary name before being renamed into place. Photo files are immutable, including replaced Hall of Fame photos, so older snapshots can still reference them. Snapshots on the same disk do not protect against losing that disk/account.
2. **Portable photo export:** Host → Archives → **Download all years & photos**. This existing ZIP includes contest records, entries, votes, messages, published winners, and their referenced photos. It excludes passwords, host sessions, browser identities, and Undo/request history. It is useful for portability; it is not a complete disaster-recovery database copy.
3. **Full recovery backup:** use the command below. It takes an online SQLite snapshot without changing or logging out the live app, includes every table (saved host password hashes, Undo, and request records included), includes all referenced photos, and records SHA-256 checksums. Copy it off the hosting service after creating it. There is no automatic offsite upload configured.

Keep an offsite copy before substantial changes and after every party. During an active party, download additional backups as often as the amount of data you can afford to lose requires. Check Render logs for `Daily database backup failed`. Watch disk usage; the configured photo cap is roughly 650 MB, but snapshots, database growth and restore staging also consume disk space.

## Create a full backup

From the repository directory in the Render service's **Shell** (not a one-off job, which cannot access the disk):

```sh
node scripts/full-backup.js /var/data /tmp/geech-full-2026-10-22.zip
```

Replace the date/filename each time. The command refuses an existing output file. If your current `DATA_DIR` is a restored subdirectory, use that exact directory instead of `/var/data`.

Download the ZIP privately using Render SSH/SCP/SFTP. In **Connect → SSH**, copy the actual host and user supplied by Render. The local command pattern is:

```sh
scp -s RENDER_SSH_USER@RENDER_SSH_HOST:/tmp/geech-full-2026-10-22.zip ./geech-full-2026-10-22.zip
```

Use Render's supplied SSH options/key and hostname, not these placeholders. `/tmp` is temporary: finish the offsite download before restarting the service. Do not publish a backup download link. A separate Render cron job cannot see this disk.

To back up this computer's preview instead:

```sh
node scripts/full-backup.js test-results/preview C:/PRIVATE-BACKUP-FOLDER/geech-full.zip
```

Choose an existing private destination folder. No command in the build/deploy pipeline runs restore, seeds sample data, or overwrites the database.

## Restore a full backup into a new directory

First keep the original disk/data and create an extra backup. Ensure enough free disk capacity for the new copy alongside the original. Never restore over `/var/data` or the active `DATA_DIR`.

1. Upload the private backup via Render's authenticated SSH/SFTP connection to a private temporary path.
2. In the **current service's Shell**, restore to a unique, nonexistent directory under the same mount:

   ```sh
   node scripts/restore-full.js /tmp/geech-full-2026-10-22.zip /var/data/restored-2026-10-22
   ```

3. Restore validates allowed paths, sizes, checksums, database integrity, foreign keys, and referenced photos. It refuses an existing destination. On failure it removes only the new directory created by that invocation. The source ZIP and existing app data stay untouched.
4. Avoid further submissions while switching. After the restored copy verifies, change only Render `DATA_DIR` to `/var/data/restored-2026-10-22` and redeploy. Leave `PERSISTENT_DISK_PATH=/var/data` and the same disk attached.
5. Verify contest names, counts, archives, photos, winners, saved host password, and Undo eligibility. A restart invalidates old host sessions; sign in again. Keep `HOST_PASSWORD` and `HOST_RECOVERY_CODE` configured privately in Render.
6. To roll back the switch, set `DATA_DIR` back to its previous value and redeploy. The original directory was not overwritten. Data submitted after a restore belongs to that restored copy; rollback does not merge divergent data. Keep both copies until everything has been verified.

Full restore currently caps total expanded size at 2 GB, any database file at 512 MB, and individual photos at 12 MB. For a larger future archive, increase/test limits and disk capacity before restoring; never work around refusal by overwriting active files.

## Restore the portable photo export

```sh
node scripts/restore.js /tmp/party-archive.zip /var/data/portable-restored-2026-10-22
```

This also requires a new destination. After a portable restore, the initial Render environment password applies until the host changes it; Undo history and existing browser identities are not restored. Use full backups for a same-site disaster recovery where that internal state matters.

## Moving existing local data online

Deploying source alone creates a new empty database only if no database exists at the selected `DATA_DIR`; it does not transfer the local preview's data. When publishing is approved, make a full preview backup, transfer it privately, restore into a new directory, and point the Render service there. Review imported scheduled hours first so local test photos are not unintentionally displayed publicly. Do not open the real party for voting until this migration/verification is complete, because browser identity cookies do not transfer from `127.0.0.1` to the live domain.

Do not use a Render disk-snapshot restore as the primary database-recovery procedure: Render cautions that custom databases can be corrupted by filesystem snapshot restores. Use consistent database backups and a tested offsite full copy. [Render disk/transfer guidance](https://render.com/docs/disks)
