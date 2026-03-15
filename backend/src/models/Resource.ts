import mongoose, { Document, Schema } from "mongoose";

interface ISummary {
  content: string;
  createdAt: Date;
}

export type ResourceType = "plain_text" | "pdf";

export type ResourceStatus =
  | "draft"
  | "upload_pending"
  | "uploaded"
  | "processing"
  | "ready"
  | "failed";

export interface IResource extends Document {
  ownerId: mongoose.Types.ObjectId;
  title: string;
  tags: string[];
  type: ResourceType;

  // Plain text resource fields
  textContent?: string;

  // File-based resource fields
  storageKey?: string;
  bucket?: string;
  mimeType?: string;
  originalFileName?: string;
  size?: number;
  status: ResourceStatus;

  summary?: ISummary;
  createdAt: Date;
  updatedAt: Date;
}

const SummarySchema = new Schema<ISummary>(
  {
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: [5000, "Summary content cannot exceed 5000 characters"],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false, // embedded document without its own id
  }
);

const ResourceSchema = new Schema<IResource>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner ID is required"],
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (tags: string[]) => tags.length <= 10,
        message: "Maximum 10 tags allowed",
      },
    },
    type: {
      type: String,
      enum: ["plain_text", "pdf"],
      default: "plain_text",
      required: true,
    },
    textContent: {
      type: String,
      required: false,
      maxlength: [100000, "Text content cannot exceed 100,000 characters"], // ~100KB
    },
    storageKey: {
      type: String,
      required: false,
      trim: true,
    },
    bucket: {
      type: String,
      required: false,
      trim: true,
    },
    mimeType: {
      type: String,
      required: false,
      trim: true,
    },
    originalFileName: {
      type: String,
      required: false,
      trim: true,
      maxlength: [255, "Original file name cannot exceed 255 characters"],
    },
    size: {
      type: Number,
      required: false,
      min: [0, "File size cannot be negative"],
    },
    status: {
      type: String,
      enum: [
        "draft",
        "upload_pending",
        "uploaded",
        "processing",
        "ready",
        "failed",
      ],
      default: "draft",
      required: true,
    },
    summary: {
      type: SummarySchema,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ResourceSchema.index({ ownerId: 1, createdAt: -1 });
ResourceSchema.index({ ownerId: 1, status: 1 });
ResourceSchema.index({ ownerId: 1, type: 1 });

export const Resource = mongoose.model<IResource>("Resource", ResourceSchema);
