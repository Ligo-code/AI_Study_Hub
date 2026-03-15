export const LIMITS = {
  TITLE_MAX_LENGTH: 200,
  TEXT_CONTENT_MAX_LENGTH: 100000, // 100KB for plain text content
  MAX_TAGS: 10,
  TAG_MAX_LENGTH: 30,

  // Quiz limits
  MAX_QUESTION_COUNT: 50,
  MIN_QUESTION_COUNT: 3,
  MIN_CHARS_PER_QUESTION: 50,

  // File upload limits
  PDF_MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
} as const;

export const ALLOWED_UPLOAD_MIME_TYPES = {
  PDF: ["application/pdf"],
} as const;

export const UPLOAD_URL_EXPIRATION = 60 * 15; // 15 minutes
export const DOWNLOAD_URL_EXPIRATION = 60 * 60; // 1 hour

export const validateEnv = () => {
  const required = [
    "MONGO_URI",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  console.log("Environment variables validated");
};
