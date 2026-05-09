import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getActiveBucket } from "../lib/firebase/admin.js";
import { isR2Configured, s3Client, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN } from "../lib/cloudflare/r2.js";
import path from "path";

export interface FileMetadata {
  name: string;
  url: string;
  fullPath: string;
  size?: number;
  updated?: string | Date;
}

export class StorageService {
  private static async getStorageProvider() {
    if (isR2Configured && s3Client) {
      return { type: 'r2' as const, client: s3Client, bucket: R2_BUCKET_NAME! };
    }
    const bucket = await getActiveBucket();
    return { type: 'firebase' as const, bucket: bucket };
  }

  static async uploadFile(file: { originalname: string; buffer: Buffer; mimetype: string }, destination: string): Promise<string> {
    const provider = await this.getStorageProvider();

    if (provider.type === 'r2') {
      const command = new PutObjectCommand({
        Bucket: provider.bucket,
        Key: destination,
        Body: file.buffer,
        ContentType: file.mimetype,
      });
      await provider.client.send(command);
      
      if (R2_PUBLIC_DOMAIN) {
        return `${R2_PUBLIC_DOMAIN}/${destination}`;
      }
      return `https://pub-your-id.r2.dev/${destination}`;
    } else {
      // Firebase logic - Try to find the correct bucket and upload
      const bucket = provider.bucket;
      const destinationPath = destination.startsWith('/') ? destination.substring(1) : destination;
      
      try {
        console.log(`[Firebase Storage] Attempting upload to bucket: ${bucket.name}, path: ${destinationPath}`);
        const blob = bucket.file(destinationPath);
        await blob.save(file.buffer, { 
          contentType: file.mimetype,
          resumable: false // Sometimes resumable uploads fail in restricted environments
        });
        await blob.makePublic().catch(e => console.warn(`[Firebase Storage] makePublic failed for ${bucket.name}:`, e.message));
        return `https://storage.googleapis.com/${bucket.name}/${destinationPath}`;
      } catch (err: any) {
        console.error(`[Firebase Storage] Upload to ${bucket.name} failed:`, err.message);
        throw new Error(`Erro ao salvar no Firebase Storage (${bucket.name}): ${err.message}`);
      }
    }
  }

  static async listFiles(prefix: string): Promise<FileMetadata[]> {
    const provider = await this.getStorageProvider();

    if (provider.type === 'r2') {
      const command = new ListObjectsV2Command({
        Bucket: provider.bucket,
        Prefix: prefix,
      });
      const response = await provider.client.send(command);
      
      if (!response.Contents) return [];

      return Promise.all(response.Contents
        .filter(item => item.Key && !item.Key.endsWith('/'))
        .map(async item => {
            const url = R2_PUBLIC_DOMAIN 
                ? `${R2_PUBLIC_DOMAIN}/${item.Key}` 
                : `https://pub-your-id.r2.dev/${item.Key}`;
                
            return {
                name: path.basename(item.Key!),
                url: url,
                fullPath: item.Key!,
                size: item.Size,
                updated: item.LastModified?.toISOString()
            };
        }));
    } else {
        // Firebase logic
        const [files] = await provider.bucket.getFiles({ prefix });
        return files
            .filter(file => !file.name.endsWith('/'))
            .map(file => ({
                name: path.basename(file.name),
                url: `https://storage.googleapis.com/${provider.bucket.name}/${file.name}`,
                fullPath: file.name,
                size: Number(file.metadata?.size),
                updated: file.metadata?.updated
            }));
    }
  }

  static async deleteFile(fullPath: string): Promise<void> {
    const provider = await this.getStorageProvider();

    if (provider.type === 'r2') {
      const command = new DeleteObjectCommand({
        Bucket: provider.bucket,
        Key: fullPath,
      });
      await provider.client.send(command);
    } else {
      await provider.bucket.file(fullPath).delete();
    }
  }

  static async checkStatus() {
    const provider = await this.getStorageProvider();
    if (provider.type === 'r2') {
        try {
            // Check if bucket is accessible
            await provider.client.send(new ListObjectsV2Command({ Bucket: provider.bucket, MaxKeys: 1 }));
            return { type: 'R2', connected: true, bucket: provider.bucket };
        } catch (e) {
            return { type: 'R2', connected: false, error: (e as Error).message };
        }
    } else {
        try {
            const [exists] = await provider.bucket.exists();
            return { type: 'Firebase', connected: exists, bucket: provider.bucket.name };
        } catch (e) {
            return { type: 'Firebase', connected: false, error: (e as Error).message };
        }
    }
  }
}
