# Artwork storage and retention

Uploads are decoded as still PNG, JPEG, or WebP images before storage. The input
limit is 5 MB, 40 megapixels, and 8,192 pixels per side. Animation is rejected.
Orientation is applied and identifying EXIF/GPS/XMP/IPTC metadata is stripped.
PNG/WebP output is lossless; JPEG is re-encoded at quality 100 with no chroma
subsampling. JPEG encoding is still lossy, and a processed file over 5 MB is
rejected with a request to reduce dimensions.
The original server metadata screening report is retained without raw metadata
values, so sanitization cannot clear an authorship-review flag. Existing database
images are also sanitized when served; malformed legacy images return an error
instead of publishing their original bytes.
Purge existing CDN upload caches when deploying this change; previously cached
original downloads cannot be replaced by changing origin behavior alone.

Accounts retain the existing hourly upload limits and have a 500 MB total artwork
allowance. Check storage capacity and alert on growth before public testing. This
per-account allowance does not replace a host/provider capacity alert.

## Private Supabase storage

For the hosted pilot, create a **private** Supabase Storage bucket, restrict its
file size to 5 MB and allowed MIME types to image/png, image/jpeg, image/webp, and
set these server-only variables:

```dotenv
ARTIQ_UPLOAD_STORAGE=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
ARTIQ_SUPABASE_STORAGE_BUCKET=artwork-private
```

Never prefix the service role key with `NEXT_PUBLIC_`, expose it in a browser,
or make the bucket public. The application verifies that the upload bucket is
private. Uploads still use `/api/uploads`; private images require the existing
owner/reviewer session, and images become public through that API only after
publication. No bucket URL, object key, or service credential is sent to clients.
Privy remains the sign-in provider.

New sanitized image bytes are stored in the bucket; the database retains the
ownership record, screening report, byte count and private storage key. Existing
database-backed images continue to work. `ARTIQ_UPLOAD_STORAGE=database` is the
local default, and changing it does not migrate existing images. Keep Supabase
credentials configured while any existing record references that bucket.

Take separate backups of **both** Postgres and the storage objects; a database
backup does not contain object bytes. Test a restore with owner-only and published
images. Configure provider storage/egress alerts and record how the private bucket
is restored. Supabase setup and an actual hosted upload/download test must be
completed before considering this integration operational.

## Bounded maintenance

Run a read-only preview first:

```sh
node --import tsx scripts/maintain-data.ts
```

The preview lists counts and total bytes, never email addresses, session hashes,
object keys, or image contents. Each batch considers at most 5,000 old uploads,
selects at most 100 orphan uploads, and selects at most 100 records from each
expired-session/challenge table. Run repeated batches if necessary. Referenced
images are retained, including pending/rejected applications, series images,
published work, and unpublished auction drafts.

Expired credentials are eligible only seven days **after expiry**. They can be
cleaned on a daily schedule without pausing normal writes:

```sh
node --import tsx scripts/maintain-data.ts --sessions-only --apply
```

Unreferenced uploads are eligible seven days after upload. Before deleting them,
take a database and object backup, stop **all** content writers, inspect a fresh
preview, then acknowledge the maintenance window explicitly:

```sh
node --import tsx scripts/maintain-data.ts --apply --writes-paused
```

Stopping writers prevents a new submission from attaching an old upload between
the reference check and deletion. `--writes-paused` is an operator acknowledgement,
not a command that pauses the app. Without it, orphan deletion is refused. Resume
the app after maintenance and verify a private and public image. The script never
removes users, applications, published work, orders, or delivery addresses. Set a
separate documented retention/support process for those personal records.

If an object upload succeeds but saving the DB record fails, the API attempts to
remove that unattached object. Provider outages can prevent cleanup; inspect
bucket inventory against stored `storageKey` values after incidents before
removing provider-side objects. Never remove an object still referenced by a row.

References: [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[Sharp output metadata behavior](https://sharp.pixelplumbing.com/api-output/).
