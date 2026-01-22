---
name: file-uploads
description: Secure file upload handling with presigned URLs, validation, virus scanning, and CDN delivery. Supports S3, GCS, and local storage.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: api
  time: 4h
  source: drift-masterguide
---

# Secure File Uploads

Handle file uploads safely with presigned URLs and validation.

## When to Use This Skill

- User profile pictures
- Document uploads
- Media attachments
- Bulk file imports

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client                            │
│                                                     │
│  1. Request presigned URL                           │
│  2. Upload directly to S3                           │
│  3. Confirm upload complete                         │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────┐
│   Your API      │  │           S3 Bucket             │
│                 │  │                                 │
│  - Generate URL │  │  - Receive file                 │
│  - Validate     │  │  - Trigger Lambda (optional)    │
│  - Store ref    │  │  - Serve via CloudFront         │
└─────────────────┘  └─────────────────────────────────┘
```

## TypeScript Implementation

### Upload Service

```typescript
// upload-service.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

interface UploadConfig {
  bucket: string;
  region: string;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  urlExpiresIn: number; // seconds
}

interface PresignedUpload {
  uploadUrl: string;
  fileKey: string;
  expiresAt: Date;
}

const config: UploadConfig = {
  bucket: process.env.S3_BUCKET!,
  region: process.env.AWS_REGION!,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  urlExpiresIn: 300, // 5 minutes
};

const s3 = new S3Client({ region: config.region });

class UploadService {
  async createPresignedUpload(
    userId: string,
    filename: string,
    contentType: string,
    contentLength: number
  ): Promise<PresignedUpload> {
    // Validate content type
    if (!config.allowedMimeTypes.includes(contentType)) {
      throw new Error(`File type not allowed: ${contentType}`);
    }

    // Validate size
    if (contentLength > config.maxSizeBytes) {
      throw new Error(`File too large. Max size: ${config.maxSizeBytes / 1024 / 1024}MB`);
    }

    // Generate unique key
    const ext = filename.split('.').pop() || '';
    const fileKey = `uploads/${userId}/${crypto.randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: fileKey,
      ContentType: contentType,
      ContentLength: contentLength,
      Metadata: {
        'user-id': userId,
        'original-filename': filename,
      },
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: config.urlExpiresIn,
    });

    return {
      uploadUrl,
      fileKey,
      expiresAt: new Date(Date.now() + config.urlExpiresIn * 1000),
    };
  }

  async confirmUpload(fileKey: string, userId: string): Promise<{ url: string }> {
    // Verify file exists and belongs to user
    const headCommand = new GetObjectCommand({
      Bucket: config.bucket,
      Key: fileKey,
    });

    try {
      const response = await s3.send(headCommand);
      const metadata = response.Metadata || {};

      if (metadata['user-id'] !== userId) {
        throw new Error('Unauthorized');
      }

      // Store reference in database
      await db.files.create({
        data: {
          key: fileKey,
          userId,
          contentType: response.ContentType,
          size: response.ContentLength,
          originalFilename: metadata['original-filename'],
        },
      });

      // Return CDN URL
      const cdnUrl = `${process.env.CDN_URL}/${fileKey}`;
      return { url: cdnUrl };
    } catch (error) {
      throw new Error('File not found or upload incomplete');
    }
  }

  async getDownloadUrl(fileKey: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: fileKey,
    });

    return getSignedUrl(s3, command, { expiresIn });
  }

  async deleteFile(fileKey: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: fileKey,
    }));

    await db.files.delete({ where: { key: fileKey } });
  }
}

export const uploadService = new UploadService();
```

### API Routes

```typescript
// upload-routes.ts
import { Router } from 'express';
import { uploadService } from './upload-service';
import { authMiddleware } from './auth';

const router = Router();

// Request presigned URL
router.post('/uploads/presign', authMiddleware, async (req, res) => {
  const { filename, contentType, contentLength } = req.body;

  if (!filename || !contentType || !contentLength) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await uploadService.createPresignedUpload(
      req.user.id,
      filename,
      contentType,
      contentLength
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Confirm upload complete
router.post('/uploads/confirm', authMiddleware, async (req, res) => {
  const { fileKey } = req.body;

  try {
    const result = await uploadService.confirmUpload(fileKey, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export { router as uploadRoutes };
```

### Frontend Upload Component

```typescript
// useFileUpload.ts
async function uploadFile(file: File): Promise<string> {
  // 1. Get presigned URL
  const presignResponse = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      contentLength: file.size,
    }),
  });

  if (!presignResponse.ok) {
    const error = await presignResponse.json();
    throw new Error(error.error);
  }

  const { uploadUrl, fileKey } = await presignResponse.json();

  // 2. Upload directly to S3
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error('Upload failed');
  }

  // 3. Confirm upload
  const confirmResponse = await fetch('/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileKey }),
  });

  const { url } = await confirmResponse.json();
  return url;
}
```

## Python Implementation

```python
# upload_service.py
import boto3
import uuid
from dataclasses import dataclass

@dataclass
class UploadConfig:
    bucket: str
    region: str
    max_size_bytes: int = 10 * 1024 * 1024
    allowed_types: list[str] = None
    url_expires_in: int = 300

class UploadService:
    def __init__(self, config: UploadConfig):
        self.config = config
        self.s3 = boto3.client("s3", region_name=config.region)

    def create_presigned_upload(
        self, user_id: str, filename: str, content_type: str, content_length: int
    ) -> dict:
        if self.config.allowed_types and content_type not in self.config.allowed_types:
            raise ValueError(f"File type not allowed: {content_type}")

        if content_length > self.config.max_size_bytes:
            raise ValueError("File too large")

        ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
        file_key = f"uploads/{user_id}/{uuid.uuid4()}.{ext}"

        url = self.s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.config.bucket,
                "Key": file_key,
                "ContentType": content_type,
            },
            ExpiresIn=self.config.url_expires_in,
        )

        return {"upload_url": url, "file_key": file_key}
```

## S3 Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPresignedUploads",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::your-bucket/uploads/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-acl": "private"
        }
      }
    }
  ]
}
```

## Security Considerations

1. **Validate file types server-side** - Don't trust Content-Type header alone
2. **Scan for viruses** - Use Lambda trigger with ClamAV
3. **Set appropriate CORS** - Restrict to your domain
4. **Use short-lived URLs** - 5-15 minutes max
5. **Validate file size** - Both client and server side

## Best Practices

- Use presigned URLs (don't proxy through your server)
- Store files with random names (prevent enumeration)
- Serve via CDN (CloudFront)
- Keep original filename in metadata only
- Set appropriate cache headers
