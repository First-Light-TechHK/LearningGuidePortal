# Modeling life course import

DEV integration: origin/dev already shipped 006_add_modeling_life_course and 007_repair_modeling_life_media. Their files/ledger identities remain intact; the registry retires their pending media-copy operations because 008 provides repository images and the supplied video URLs. An existing legacy two-content-per-Lesson template is upgraded by 008 to 5/2 text and video points and authored resources, preserving Course/Lesson/section identities, operator Course metadata and user history. Existing authored point identities skip without overwriting operator edits. 009 corrects Exploration for prior four-item local imports. No old migration is renumbered or replayed; build-time migration/signing guards and the upstream KS Tutor drawer remain. Tests cover both an already-shipped template and a fresh registry with zero S3 operations. Post-deploy smoke no longer runs the superseded media-copy script automatically; that explicit legacy repair CLI remains available.

Exhibit correction (2026-10-23): the user confirmed only two standalone exhibits, both belonging to Lesson 1. The earlier import incorrectly included Word-only Exhibit 1.3 (States Have Units) and Exhibit 1.8 in Exploration. Fresh migration 008 now contains only the confirmed two; 009_fix_modeling_life_exhibits updates already-imported courses through the ORM without changing text/images, readings, assessments, Lesson 2, other courses or user progress. Existing Exploration IDs 1-2/1-4 remain stable, with titles, originals and thumbnails matching the two timed video nodes. Whole course totals two, Lesson 2 totals zero. No cloud execution.

The local source package is converted into `db/data-migrations/008_upgrade_modeling_life.ts`. All course text, metadata, video point starts, resources, questions and preview settings are contained in that single migration. It has no dependency on the original source directory at runtime. Source filenames and SHA-256 checksums are recorded in `modelingLifeImport` inside the script.

The migration creates the published `modeling-life` Course in Science through `orm.table("courses")`, with two Lessons. It declares `touches = ["courses"]`. Stable course, section, Lesson, point, question and exhibit identities are identical in local, DEV and SIT. Existing matching course identities are skipped without overwriting operator changes; conflicting IDs/slugs fail. No price, plan, account, Order, Payment, Subscription, Entitlement or learner assessment record is seeded.

## Source mapping

| Source | Destination |
|---|---|
| `modeling life课程信息.xlsx` → `course info` | Science, title, subtitle, overview, six learning outcomes and six course features |
| `Lessons` | Lesson titles/summaries, point titles, video start times and two timed video exhibits |
| `Lesson 1 文本课件.docx` | Lesson 1 text points 1.1–1.5, with all English/Chinese paragraphs, tables and 12 embedded images |
| `Lesson 2文本课件.docx` | Lesson 2 text points 2.1–2.2, with all English/Chinese paragraphs, tables and 17 embedded images |
| `exploration-reading list` | Three Lesson 1 readings; Exploration includes only the two confirmed Lesson 1 video exhibits. Other Word figures and tables remain in the lesson text |
| `knowledge test` | 18 ordered Lesson 1 questions with reference answers |
| `application test` | One Lesson 1 question and its complete reference answer |

The repeated Lesson 1 wording in the import request for points 2.1–2.2 is interpreted as Lesson 2. Knowledge/Application sheet data are assessment definitions rather than reading-list entries. Lesson 2 has no supplied reading list or assessments, so those collections remain empty and never fall back to demonstration content.

Authored course material retains its source languages on both UI locales; it is not stored in UI translation files. No AI rewrite, translation, generated answer or AI grade is added. Application retains the existing server-timed submission lifecycle but authored results display submission and reference content without the sample Strong feedback.

## Images and video links

All 34 PNG assets are repository files in `public/courses/modeling-life/`: 29 embedded Word images, `cover.png`, two original video exhibit images and two `-s` thumbnails. URLs use `/courses/modeling-life/<filename>`. Extraction preserved the original image bytes; the migration's manifest records each checksum. No asset points to a source-machine drive or an environment-specific upload ID. These are public static image URLs by the user's explicit local-reference choice; restricted text bodies and assessment definitions retain their existing server access checks.

The user-supplied video URLs are assigned per Lesson; all five Lesson 1 video points use the first URL and both Lesson 2 video points use the second:

```text
Lesson 1: https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/staging/modeling-life/lesson1.mp4
Lesson 2: https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/staging/modeling-life/lesson2.mp4
```

These are private S3 object identities, not public playback URLs. After the existing page Session/Entitlement checks, `signCourseMediaReferences` generates fresh 30-minute signed GET URLs for the browser. The signing allowlist includes exactly these two staging paths alongside the existing legacy media prefix. The migration stores stable unsigned URLs, never expiring signatures or AWS secrets. UAT still requires its pinned media release manifest.

The signing identity must also have `s3:GetObject` permission for both objects. The narrow identity policy is `deploy/modeling-life-media-read-policy.json`; an AWS administrator must attach it to the local AWS identity and to each relevant DEV/SIT App Runner **instance/runtime role**. The App Runner ECR access/build role is not the application runtime identity. Existing credentials can be used after permission is granted; no browser AWS key or public-bucket change is needed. This task does not change live IAM policies.

Live read-only diagnosis: both unsigned URLs returned 403 AccessDenied. With the locally configured credentials, the existing Horace video returned HTTP 206 for a 32-byte signed Range request, but both Modeling life signed requests returned 403. S3's error explicitly identified a missing identity-based allow; generating a signature alone cannot fix that IAM permission. After applying the policy, repeat signed Range GET on both videos and verify 206/video bytes before declaring playback fixed. No credential, signed URL or session token is recorded in this document or test output.

The supplied MP4 files are not copied into git or uploaded by this task. Original source durations (24:29 and 26:24, rounded to whole seconds) provide syllabus metadata; playback metadata comes from each linked video. These URLs replace the earlier Horace placeholder in the still-unreleased migration 008. Once 006 has been applied in an environment, later URL changes require a new forward migration rather than editing recorded migration history.

Excel cells use `h:mm` formatting to display video timestamps such as `6:52`. The import interprets those displayed values as minutes:seconds, consistent with the supplied source video lengths. They are absolute source positions, not time relative to the selected point.

| Lesson | Video point starts |
|---|---|
| 1 | 1.1 = 0:10; 1.2 = 6:52; 1.3 = 9:47; 1.4 = 17:06; 1.5 = 19:35 |
| 2 | 2.1 = 0:10; 2.2 = 20:04 |

Lesson 1's two timed video exhibits are `T, W, V, C` at 0:37 and `Three examples of one-dimensional state spaces` at 2:40. Each uses its matching `lesson1-exhibit-N-s.png` thumbnail and `lesson1-exhibit-N.png` viewer image. Original descriptions and source fields are retained. Normal playback crossing the time offers the existing exhibit prompt; opening the viewer remains explicit.

## Preview and authored resources

Only Lesson 1 is public preview. Its configured text policy delivers the whole first point (1.1), withholding text/nodes from 1.2–1.5 while retaining outline metadata. The inline preview-end entry appears at the end of 1.1 and does not auto-open a dialog. The preview Study API rejects writes to those locked text points and video points starting at/after the cutoff. Lesson 2 remains restricted. Entitled learners receive all seven points in either mode and both Lessons.

Video preview uses the existing player cutoff with a course-specific 600-second limit, measured on the source timeline; seeks at/past 10:00 clamp to 10:00 and open the existing access-plan dialog. Existing Courses retain their 60-second video preview and two-point/half-text policy. Authored text/video points omit demonstration exhibit insertion. Per-mode outline numbering begins at 1.1 or 2.1 independently of the other mode.

Only server-authorised learning pages receive the authored Exploration data. Assessment question/reference content is returned by authenticated assessment GET after the existing Course Entitlement and Study/sequencing checks; it is not included in public lesson/page props. Knowledge writes require exactly the Lesson's 18 responses. Understanding and the completion dialog use the authored test availability/count, so missing Lesson 2 tests do not become sample tests or inflate the total (two available tests for this Course). Old Courses retain their sample definitions and counts.

## Local validation and later DEV/SIT application

Local validation commands:

```powershell
npm run typecheck
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test --test-concurrency=1 tests/unit/modeling-life-migration.test.ts tests/unit/modeling-life-page.test.ts
npm run data:migrate -- --dry-run
npm run build
```

Run a dry-run with the intended local configuration. It must report `008_upgrade_modeling_life`, one `course` add (or an update for the shipped legacy template), `persisted:false` and zero S3 objects. Migration 009 is registered after 008: fresh imports already contain the corrected two exhibits, while an older four-item import receives a Lesson 1 exhibit-only update. After both migrations are recorded, repeat runs skip. The generated script and assets are sufficient for a local app to project the new course via its usual migration-aware store; no cloud execution was performed during this task.

For DEV, release the application support code, migration registry, 008, 009 and the complete asset directory together. The normal `dev` deployment/start sequence runs the registered ORM migration. For SIT, release the same revision through the existing manual SIT deployment process; that environment applies its own pending migration ledger. Do not copy a local `product.json`, use local upload IDs, run raw SQL, or transplant DEV user/payment data into SIT. The subsequent user request authorises committing and pushing dev, which uses the normal DEV pipeline; SIT remains a separate manual release. No direct cloud migration is run from this workspace.

After deployment, check both locales on desktop/mobile: course detail overview/outcomes/features and two syllabus rows; all text/image points and 5/2 video point navigation; preview 1.1 and 10:00 boundaries; both timed exhibit titles/thumbnail/full-size pairs; three reading entries/two Lesson 1 exhibits; 18 Knowledge cards, result/retake/reload; Application save/submission/reference; absent Lesson 2 tests; signed-out/expired access and a second account. Repeat the migration to verify skip and preservation of operator edits. Confirm all static assets return 200 on both environments. Verify both supplied video URLs can be delivered in the intended environment; local timing tests simulate playback events and do not certify remote video decoding.

Local validation passed: main and I/O TypeScript checks, production build, ORM dry-run, migration idempotence/protected-domain checks, all 34 asset checksums and all 29 embedded image decodes, real assessment API persistence with 18 responses and bilingual desktop/mobile browser regressions. Existing course authoring, private media, previews, learning completion and sample assessment regressions also passed. Target-environment smoke remains pending. UI changes reuse the existing designed layouts; screenshots verify the new data fits those layouts, without claiming a new Figma pixel-level acceptance.
