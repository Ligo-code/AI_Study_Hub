import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  UPLOAD_URL_EXPIRATION,
  DOWNLOAD_URL_EXPIRATION,
} from "../config/constants";

class StorageService {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;
    const bucket = process.env.S3_BUCKET;

    if (!endpoint || !accessKey || !secretKey || !bucket) {
      throw new Error(
        "Missing required S3 environment variables: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET"
      );
    }

    this.bucket = bucket;

    this.s3Client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }

  async generatePresignedUploadUrl(
    key: string,
    contentType: string
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      });

      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: UPLOAD_URL_EXPIRATION,
      });

      console.log("[StorageService] Generated presigned upload URL", {
        key,
        contentType,
      });

      return url;
    } catch (error) {
      console.error(
        "[StorageService] Failed to generate presigned upload URL",
        { key, error }
      );

      throw new Error(
        `Storage service error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async generatePresignedDownloadUrl(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: DOWNLOAD_URL_EXPIRATION,
      });

      console.log("[StorageService] Generated presigned download URL", { key });
      return url;
    } catch (error) {
      console.error(
        "[StorageService] Failed to generate presigned download URL",
        { key, error }
      );
      throw new Error(
        `Storage service error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Checks if an object exists in storage.
   * Useful before generating download URLs or for cleanup jobs.
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      console.log("[StorageService] Object exists", { key });
      return true;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: string }).name === "NotFound"// implement helper type guard instead of this check
      ) {
        console.log("[StorageService] Object not found", { key });
        return false;
      }
      // If other error (e.g., permissions) - throw it
      console.error("[StorageService] Failed to check object existence", {
        key,
        error,
      });
      throw new Error(
        `Storage service error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      // Note: S3 DeleteObject is idempotent - no error if key doesn't exist
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      console.log("[StorageService] Deleted object", { key });
    } catch (error) {
      console.error("[StorageService] Failed to delete object", { key, error });
      throw new Error(
        `Storage service error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  getBucketName(): string {
    return this.bucket;
  }
}

export const storageService = new StorageService();
