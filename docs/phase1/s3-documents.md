# DEV S3 documents: access by key

Cite this file as `docs/phase1/s3-documents.md`. Do not use a GitHub `/blob/` URL.

Uploaded 20 September 2026 from `/Users/mayongning/Documents/teachers` and `/Users/mayongning/Documents/mvp` into the private DEV data bucket. These objects are **raw S3 keys**. They are not registered in `app_files` and the Learning Guide Portal does not serve them.

The bucket blocks public access. A bare `https://…/<key>` URL returns 403. Use the **read-only IAM access key** below, or generate a short-lived presigned URL from it.

## Read-only key

IAM user `learning-guide-dev-documents-readonly` can only list and download this prefix. It cannot write, delete, or list the rest of the DEV bucket.

| | Value |
|---|---|
| IAM user | `learning-guide-dev-documents-readonly` |
| Policy | `LearningGuideDevDocumentsReadOnly` |
| Access key ID | `AKIA4MXTKRUNYBPHEPD5` |
| Secret access key | **not in git** — issued once to the operator |
| Allowed | `s3:ListBucket` on prefix `learning-guide/dev/documents/*`; `s3:GetObject` / `s3:GetObjectVersion` on those objects |
| Denied | `PutObject`, `DeleteObject`, list of `learning-guide/dev/` outside `documents/` |

Configure a local profile (do not commit `~/.aws/credentials`):

```text
[lg-dev-documents-ro]
aws_access_key_id = AKIA4MXTKRUNYBPHEPD5
aws_secret_access_key = <secret given to the operator>
region = ap-southeast-1
```

Then:

```bash
aws s3 ls s3://aitutor-data-851987565851/learning-guide/dev/documents/ --recursive --profile lg-dev-documents-ro
aws s3 cp "s3://aitutor-data-851987565851/learning-guide/dev/documents/mvp/image/1.jpg" ./1.jpg --profile lg-dev-documents-ro
aws s3 presign "s3://aitutor-data-851987565851/learning-guide/dev/documents/mvp/image/1.jpg" --expires-in 3600 --profile lg-dev-documents-ro
```

Rotate with `aws iam create-access-key` / `delete-access-key` on that user. Do not reuse the operator `cursor-aitutor-setup` key for sharing.

## Location

| | Value |
|---|---|
| Account | `851987565851` |
| Region | `ap-southeast-1` |
| Bucket | `aitutor-data-851987565851` |
| Prefix | `learning-guide/dev/documents/` |
| URI | `s3://aitutor-data-851987565851/learning-guide/dev/documents/` |

Key formula:

```text
learning-guide/dev/documents/<teachers|mvp>/<path inside the local folder>
```

`DATA_S3_PREFIX` on DEV is `learning-guide/dev`. `services/persistence/s3.ts` `toS3Key(relativePath)` prepends that prefix, so the matching relative path is `documents/teachers/…` or `documents/mvp/…`.

## Access by key

Replace `<key>` with a full key from the tables below. Quote keys that contain spaces or non-ASCII names.

Download:

```bash
aws s3 cp "s3://aitutor-data-851987565851/<key>" ./outfile --region ap-southeast-1
```

Example:

```bash
aws s3 cp "s3://aitutor-data-851987565851/learning-guide/dev/documents/mvp/video/Chinese jade.mp4" "./Chinese jade.mp4" --region ap-southeast-1
```

Head / metadata:

```bash
aws s3api head-object --bucket aitutor-data-851987565851 --key "<key>" --region ap-southeast-1
```

Temporary HTTPS link (SigV4 maximum 7 days = 604800 seconds). Do not commit the printed URL; it embeds the caller access-key id and expires.

```bash
aws s3 presign "s3://aitutor-data-851987565851/<key>" --expires-in 3600 --region ap-southeast-1
```

SDK `GetObject`:

```ts
GetObjectCommand({
  Bucket: "aitutor-data-851987565851",
  Key: "learning-guide/dev/documents/mvp/image/1.jpg"
})
```

List this prefix:

```bash
aws s3 ls s3://aitutor-data-851987565851/learning-guide/dev/documents/ --recursive --human-readable --region ap-southeast-1
```

## Real keys: teachers

Source: `/Users/mayongning/Documents/teachers` (3 files).

| Key |
|---|
| `learning-guide/dev/documents/teachers/1/video/2026/08/21ba8aad-f0e7-4254-90ba-3a7c7df6296f.mp4` |
| `learning-guide/dev/documents/teachers/1/video/2026/08/54078d97-8d78-4e27-85c5-d04e9f553e69.mp4` |
| `learning-guide/dev/documents/teachers/1/video/2026/08/bf96fce7-68f5-4933-b81c-40f1adcef50f.mp4` |

## Real keys: mvp

Source: `/Users/mayongning/Documents/mvp` (69 files).

### image

| Key |
|---|
| `learning-guide/dev/documents/mvp/image/1.jpg` |
| `learning-guide/dev/documents/mvp/image/2.1.png` |
| `learning-guide/dev/documents/mvp/image/2.2.png` |
| `learning-guide/dev/documents/mvp/image/2.3.png` |
| `learning-guide/dev/documents/mvp/image/2.4.png` |
| `learning-guide/dev/documents/mvp/image/3.jpg` |
| `learning-guide/dev/documents/mvp/image/4.jpeg` |
| `learning-guide/dev/documents/mvp/image/5.1.png` |
| `learning-guide/dev/documents/mvp/image/6.png` |
| `learning-guide/dev/documents/mvp/image/7.1.png` |
| `learning-guide/dev/documents/mvp/image/7.2.png` |
| `learning-guide/dev/documents/mvp/image/8.jpg` |
| `learning-guide/dev/documents/mvp/image/9.jpg` |
| `learning-guide/dev/documents/mvp/image/10.jpg` |
| `learning-guide/dev/documents/mvp/image/11.jpg` |
| `learning-guide/dev/documents/mvp/image/ChatGPT.jpeg` |
| `learning-guide/dev/documents/mvp/image/Horatius.jpg` |
| `learning-guide/dev/documents/mvp/image/Soracte_Ode_-_Illustration_Test_01.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_01.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_02.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_03.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_04.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_05.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_06.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_07.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_08.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_09.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_10.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_11.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_12.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_13.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_14.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_15.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_16.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_17.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_18.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_19.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_20.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_21.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_22.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_23.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_24.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_25.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_26.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_27.jpg` |
| `learning-guide/dev/documents/mvp/image/What is ChatGPT Doing - Exhibits_28.jpg` |
| `learning-guide/dev/documents/mvp/image/cover.png` |
| `learning-guide/dev/documents/mvp/image/shaolutu_exp.jpg` |
| `learning-guide/dev/documents/mvp/image/unnamed.jpg` |
| `learning-guide/dev/documents/mvp/image/主题面.png` |
| `learning-guide/dev/documents/mvp/image/微信图片_20260721155328_803_445.png` |
| `learning-guide/dev/documents/mvp/image/微信图片_20260721155330_971_391.png` |

### other

| Key |
|---|
| `learning-guide/dev/documents/mvp/other/Horace Recording.m4a` |
| `learning-guide/dev/documents/mvp/other/Horace-English-Text-for-First-Ideas-Exhibits-v-10.html` |
| `learning-guide/dev/documents/mvp/other/Mulan Jade Object (Full Ver)1.obj` |
| `learning-guide/dev/documents/mvp/other/Mulan Jade Object (Full Ver)2.mtl` |

### pdf

| Key |
|---|
| `learning-guide/dev/documents/mvp/pdf/2023年08月碳排报告.pdf` |
| `learning-guide/dev/documents/mvp/pdf/McFarland Doctoral Thesis Final.pdf` |
| `learning-guide/dev/documents/mvp/pdf/mysql.pdf` |
| `learning-guide/dev/documents/mvp/pdf/test.pdf` |

### picture

| Key |
|---|
| `learning-guide/dev/documents/mvp/picture/lieqibitong_exp.jpg` |
| `learning-guide/dev/documents/mvp/picture/shaolutu_exp.jpg` |

### video

| Key |
|---|
| `learning-guide/dev/documents/mvp/video/731_1776784121.mp4` |
| `learning-guide/dev/documents/mvp/video/Chinese jade.mp4` |
| `learning-guide/dev/documents/mvp/video/Soracte_Ode.mp4` |
| `learning-guide/dev/documents/mvp/video/What Is ChatGPT Doing.mp4` |
| `learning-guide/dev/documents/mvp/video/beach.mov` |
| `learning-guide/dev/documents/mvp/video/test.mp4` |
| `learning-guide/dev/documents/mvp/video/贺拉斯诗歌为何值得一读.mp4` |

## Index object

| Key |
|---|
| `learning-guide/dev/documents/index.html` |

That HTML listing is only useful after you generate a fresh presigned URL for it. The copy uploaded on 20 September 2026 already contains expired file links.

## What this is not

- Not public CDN or Portal media (`/api/course-media/*`).
- Not SIT (`learning-guide-sit-851987565851`, prefix `learning-guide/sit`).
- Not product VFS paths such as `learning-guide/dev/learning_guide/avatars/<user_id>.jpg`.
- Do not make the bucket public to “get a stable link”. Presign per key instead.
