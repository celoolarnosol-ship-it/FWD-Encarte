import { S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
const bucketName = process.env.CLOUDFLARE_BUCKET_NAME;

export const isR2Configured = !!(accountId && accessKeyId && secretAccessKey && bucketName);

export const s3Client = isR2Configured ? new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
  },
}) : null;

export const R2_BUCKET_NAME = bucketName;
export const R2_PUBLIC_DOMAIN = process.env.CLOUDFLARE_PUBLIC_DOMAIN || "";
