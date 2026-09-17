# Course Management — upload and commit

Black-box I/O against `POST /api/backoffice/courses/:courseId/media`, draft save, publish, and `GET/HEAD /api/course-media/:courseId/:assetId`.
Suite is active. Overlay select runs this product_command. Do not rewrite leaves to match signature-only rasters, cover HTTPS skips, or COS writes.

Unit locks today live in `tests/unit/course-media.test.ts`. They are not Overlay I/O. `scripts/test-lgteacher-complete.ts` is release-manual and is not in Verify.

## CM-01 Size and emptiness


### Functional
- Title: A real image under the server cap is accepted
- Steps: Teacher POST multipart `file` PNG under 25 MiB with `usage=content-image`
- Expected: HTTP 201; one private `/api/course-media/:courseId/:assetId`; no `uploadedBy` in JSON


### Negative
- Title: Empty or oversize bytes never persist
- Steps: POST empty file; POST `COURSE_MEDIA_MAX_BYTES + 1`; POST a chunked body with no Content-Length that exceeds the cap
- Expected: HTTP 413; no new `.bin`. INV-media-before-commit


### Edge
- Title: Declared length and duplicate fields fail closed
- Steps: Content-Length above the cap with a small body; two `file` fields
- Expected: 413 for the lie; 400 for duplicates; stream cancelled when over the cap
- Title: Exactly 25 MiB with a valid signature is accepted
- Steps: POST a valid PNG whose size is `COURSE_MEDIA_MAX_BYTES`
- Expected: HTTP 201 if signature and decode also pass

## CM-02 Signature and container


### Functional
- Title: Matching extension, MIME and signature store as the declared fileType
- Steps: POST valid jpg/png/gif/webp/pdf/mp4/mov/webm/audio/obj/glb
- Expected: 201; `fileType` matches the format table


### Negative
- Title: Spoofed name, MIME or payload is 415
- Steps: SVG/HTML/exe; `../` name; PNG bytes as `text/html`; truncated PDF/MP3; OBJ with `mtllib`; GLB with a `uri`
- Expected: HTTP 415; no `.bin`


### Edge
- Title: Containers must be closed and self-contained
- Steps: JPEG without EOI; PNG without IEND; GIF without trailer; WebP RIFF size lie; PDF without `%%EOF`; MP4/MOV without ftyp+moov+mdat; WebM without EBML; GLB length lie
- Expected: HTTP 415. Video/audio are container-checked only (no ffmpeg). INV-media-before-commit

## CM-03 Decode before persist


### Functional
- Title: Rasters full-decode before VFS write
- Steps: POST a complete static JPG/PNG/WebP at most 16 megapixels (same bar as portal CMS decode)
- Expected: 201 only after every pixel decodes; then draft/publish may reference it. INV-media-before-commit


### Negative
- Title: Truncated or bomb rasters never write
- Steps: Signature-valid but truncated JPEG/PNG/WebP; compressed image over 16 megapixels
- Expected: Rejected before any `.bin`. GIF animation is not a silent accept


### Edge
- Title: Decode runs again on draft/publish, including cover
- Steps: Replace stored bytes with a truncated image after upload; PUT draft / publish; set cover to an HTTPS URL that skips `/api/course-media`
- Expected: Commit 400; HTTPS cover cannot skip byte or decode checks. Video stays container-only — specified, not a hole

## CM-04 Authorisation and origin


### Functional
- Title: Assigned teacher on the admin host uploads
- Steps: Admin host, admin cookie, same origin, owned course
- Expected: HTTP 201. INV-media-authz


### Negative
- Title: Missing, student, foreign-teacher, learner-cookie or foreign-origin is 403
- Steps: No cookie; student; other teacher; learner cookie on admin or learner host; `origin: https://evil.test`; empty origin
- Expected: HTTP 403; no asset


### Edge
- Title: Transport and storage fail closed
- Steps: Teacher learner cookie GET unpublished/unattached; PROD without persistence
- Expected: Learner transport 404; PROD 503. INV-media-authz

## CM-05 References before commit


### Functional
- Title: Draft and publish require course-owned typed refs
- Steps: Upload; attach matching image/audio/video/pdf/model; PUT draft; publish
- Expected: Commit succeeds only after `assertCourseMediaReferences`. INV-media-before-commit


### Negative
- Title: Missing, cross-course or type-mismatched refs do not commit
- Steps: Missing asset id; other course URL; audio URL in an `img`; HTML that only substring-mentions a URL
- Expected: 400 or 404; aggregate unchanged


### Edge
- Title: Inactive or orphan refs grant no learner GET
- Steps: Publish with `active: false` content or an unattached upload; entitled GET
- Expected: HTTP 404 for learners; author admin preview still 200. Relates CM-07

## CM-06 External write reject


### Functional
- Title: New lesson and cover writes only persist same-course media URLs
- Steps: PUT draft with `/api/course-media/:thisCourse/:id`
- Expected: 200; stored URL stays on this course. INV-no-external-write


### Negative
- Title: COS or other HTTPS media on write is 400
- Steps: Save or publish `https://` COS or any off-origin media URL in contents or cover
- Expected: HTTP 400; no commit. INV-no-external-write


### Edge
- Title: Legacy HTTPS COS may render on read only
- Steps: Read a historically published lesson whose stored URL is HTTPS COS; then save that lesson unchanged vs replace a node with a new COS URL
- Expected: Read may keep the legacy URL; a new write that introduces COS is 400

## CM-07 Learner exposure


### Functional
- Title: Published public-lesson refs are GET 200 without a cookie
- Steps: Publish; GET the public-first-lesson image with no cookie
- Expected: HTTP 200; `private, no-store`; nosniff. Course and public-lesson pages do not require sign-in for that published preview. INV-media-authz


### Negative
- Title: Draft, paid-only, orphan, expired or inactive media is 404
- Steps: GET those assets as tourist and as entitled student after expiry
- Expected: HTTP 404; no bytes


### Edge
- Title: HTML persist drops executable instance-content and keeps exhibit URLs
- Steps: Save HTML with `data-instance-content` script and an exhibit media URL
- Expected: Persisted HTML has no executable instance-content; exhibit URL remains; fallback image does not cover the exhibit
- Title: Range GET stays private and bounded
- Steps: Author GET with `Range: bytes=2-5` and invalid ranges
- Expected: 206 with exact slice; invalid 416; HEAD has no body

Specified / not tested now (prose, not a function_id): no ffmpeg transcode; no malware scan; no orphan `.bin` GC; no built-app upload inside Verify; `test-lgteacher-complete.ts` stays release-manual. Do not add Overlay I/O to `test:ci`.
