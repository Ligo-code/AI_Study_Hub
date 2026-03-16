import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Resource } from "../models/Resource";
import {
  LIMITS,
  ALLOWED_UPLOAD_MIME_TYPES,
  UPLOAD_URL_EXPIRATION,
} from "../config/constants";
import {
  validateTitle,
  validateTextContent,
  validateTags,
  parseTags,
  normalizeText,
} from "../utils/validation";
import { generateSummaryFromText } from "../services/summaryGenerator";
import { storageService } from "../services/storage.service";
import crypto from "crypto";

const requireUserObjectId = (
  req: Request,
  res: Response
): mongoose.Types.ObjectId | null => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({
      success: false,
      error: "User not authenticated",
    });
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    res.status(400).json({
      success: false,
      error: "Invalid user ID",
    });
    return null;
  }
  return new mongoose.Types.ObjectId(userId);
};

const handleCastError = (error: any, res: Response): boolean => {
  if (error?.name === "CastError") {
    res.status(400).json({
      success: false,
      error: "Invalid resource ID format",
    });
    return true;
  }
  return false;
};

// Create resource (plain text only)
export const createResource = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { title, tags: rawTags, textContent } = req.body;

    const titleValidation = validateTitle(title);
    if (!titleValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: titleValidation.error,
      });
    }

    const contentValidation = validateTextContent(textContent);
    if (!contentValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: contentValidation.error,
      });
    }

    const parsedTags = parseTags(rawTags);
    if (parsedTags.length > LIMITS.MAX_TAGS) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${LIMITS.MAX_TAGS} tags allowed`,
      });
    }

    const resource = new Resource({
      ownerId,
      title: normalizeText(title),
      tags: validateTags(parsedTags),
      textContent: normalizeText(textContent),
      type: "plain_text",
    });

    const savedResource = await resource.save();

    return res.status(201).json({
      success: true,
      resource: savedResource,
    });
  } catch (error: any) {
    next(error);
  }
};

export const initPdfUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { title, originalFileName, mimeType, size, tags: rawTags } = req.body;

    // Validate title
    const titleValidation = validateTitle(title);
    if (!titleValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: titleValidation.error,
      });
    }

    // Validate mime type
    if (!ALLOWED_UPLOAD_MIME_TYPES.PDF.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        error: "Only PDF files are supported",
      });
    }

    // Validate file size
    if (typeof size !== "number" || size <= 0) {
      return res.status(400).json({
        success: false,
        error: "File size must be a positive number",
      });
    }
    if (size > LIMITS.PDF_MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        error: `File size exceeds ${LIMITS.PDF_MAX_FILE_SIZE} bytes`,
      });
    }

    const parsedTags = parseTags(rawTags);

    if (parsedTags.length > LIMITS.MAX_TAGS) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${LIMITS.MAX_TAGS} tags allowed`,
      });
    }

    // Generate storage key
    const randomId = crypto.randomBytes(16).toString("hex");
    const storageKey = `resources/${ownerId}/${randomId}.pdf`;

    // Create resource in DB (upload pending)
    const resource = new Resource({
      ownerId,
      title: normalizeText(title),
      tags: validateTags(parsedTags),
      type: "pdf",
      storageKey,
      bucket: storageService.getBucketName(),
      originalFileName,
      mimeType,
      size,
      status: "upload_pending",
    });

    const savedResource = await resource.save();

    // Generate presigned URL with error handling
    try {
      const uploadUrl = await storageService.generatePresignedUploadUrl(
        storageKey,
        mimeType
      );

      console.log("[resource] Initiated PDF upload", {
        resourceId: savedResource._id.toString(),
        ownerId: ownerId.toString(),
        storageKey,
        fileSize: size,
      });

      return res.status(200).json({
        success: true,
        resourceId: savedResource._id,
        uploadUrl,
        storageKey,
        expiresIn: UPLOAD_URL_EXPIRATION,
      });
    } catch (uploadError) {
      // Rollback: delete the created resource
      await Resource.findByIdAndDelete(savedResource._id);

      console.error("[resource] Failed to generate upload URL", {
        resourceId: savedResource._id.toString(),
        error: uploadError,
      });

      return res.status(500).json({
        success: false,
        error: "Failed to initialize upload. Please try again.",
      });
    }
  } catch (error) {
    next(error);
  }
};

export const completeUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { id } = req.params;

    const resource = await Resource.findOne({ _id: id, ownerId });

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: "Resource not found",
      });
    }

    if (resource.type !== "pdf") {
      return res.status(400).json({
        success: false,
        error: "Complete upload is only supported for PDF resources",
      });
    }

    if (!resource.storageKey) {
      return res.status(400).json({
        success: false,
        error: "Resource does not have a storage key",
      });
    }

    if (resource.status !== "upload_pending") {
      return res.status(400).json({
        success: false,
        error: `Resource upload cannot be completed from status "${resource.status}"`,
      });
    }

    const fileExists = await storageService.objectExists(resource.storageKey);

    if (!fileExists) {
      return res.status(400).json({
        success: false,
        error: "Uploaded file was not found in storage",
      });
    }

    resource.status = "uploaded";
    await resource.save();

    console.log("[resource] Upload completed", {
      resourceId: resource._id.toString(),
      ownerId: ownerId.toString(),
      storageKey: resource.storageKey,
    });

    return res.status(200).json({
      success: true,
      resource,
    });
  } catch (error: any) {
    if (handleCastError(error, res)) return;
    next(error);
  }
};

export const getUserResources = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const resources = await Resource.find({ ownerId })
      .sort({ createdAt: -1 })
      .select("-__v")
      .lean();

    return res.status(200).json({
      success: true,
      count: resources.length,
      resources,
    });
  } catch (error: any) {
    next(error);
  }
};

export const getResourceById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { id } = req.params;

    const resource = await Resource.findOne({ _id: id, ownerId })
      .select("-__v")
      .lean();

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: "Resource not found",
      });
    }

    return res.status(200).json({
      success: true,
      resource,
    });
  } catch (error: any) {
    if (handleCastError(error, res)) return;
    next(error);
  }
};

export const updateResource = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { id } = req.params;
    const { title, tags: rawTags, textContent } = req.body;

    const updateData: Record<string, any> = {};

    if (title !== undefined) {
      const titleValidation = validateTitle(title);
      if (!titleValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: titleValidation.error,
        });
      }
      updateData.title = normalizeText(title);
    }

    if (rawTags !== undefined) {
      const parsedTags = parseTags(rawTags);

      if (parsedTags.length > LIMITS.MAX_TAGS) {
        return res.status(400).json({
          success: false,
          error: `Maximum ${LIMITS.MAX_TAGS} tags allowed`,
        });
      }

      updateData.tags = validateTags(parsedTags);
    }

    if (textContent !== undefined) {
      const contentValidation = validateTextContent(textContent);
      if (!contentValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: contentValidation.error,
        });
      }
      updateData.textContent = normalizeText(textContent);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No valid fields to update. Only title, tags, and text content can be updated.",
      });
    }

    const updatedResource = await Resource.findOneAndUpdate(
      { _id: id, ownerId },
      updateData,
      { new: true }
    )
      .select("-__v")
      .lean();

    if (!updatedResource) {
      return res.status(404).json({
        success: false,
        error: "Resource not found",
      });
    }

    return res.status(200).json({
      success: true,
      resource: updatedResource,
    });
  } catch (error: any) {
    if (handleCastError(error, res)) return;
    next(error);
  }
};

export const deleteResource = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { id } = req.params;

    const resource = await Resource.findOne({ _id: id, ownerId });

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: "Resource not found",
      });
    }

    // If resource has a file in storage, delete it
    if (resource.storageKey) {
      try {
        await storageService.deleteObject(resource.storageKey);

        console.log("[resource] File deleted from storage", {
          resourceId: resource._id.toString(),
          storageKey: resource.storageKey,
        });
      } catch (storageError) {
        console.error("[resource] Failed to delete file from storage", {
          resourceId: resource._id.toString(),
          storageKey: resource.storageKey,
          error: storageError,
        });
      }
    }

    await resource.deleteOne();

    return res.status(204).send();
  } catch (error: any) {
    if (handleCastError(error, res)) return;
    next(error);
  }
};

export const generateSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ownerId = requireUserObjectId(req, res);
    if (!ownerId) return;

    const { id } = req.params;

    const resource = await Resource.findOne({ _id: id, ownerId });

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: "Resource not found",
      });
    }

    try {
      if (!resource.textContent || !resource.textContent.trim()) {
        return res.status(400).json({
          success: false,
          message:
            "This resource does not contain text content for summary generation",
        });
      }
      const summaryContent = await generateSummaryFromText(
        resource.textContent
      );

      resource.summary = {
        content: summaryContent,
        createdAt: new Date(),
      };

      await resource.save();

      return res.status(200).json({
        success: true,
        summary: resource.summary,
      });
    } catch (summaryError: any) {
      if (summaryError instanceof Error) {
        if (
          summaryError.message.includes("too short") ||
          summaryError.message.includes("too long") ||
          summaryError.message.includes("required")
        ) {
          return res.status(400).json({
            success: false,
            error: summaryError.message,
          });
        }

        if (summaryError.message.includes("GEMINI_API_KEY")) {
          console.error("[resource] Gemini API key missing");
          return res.status(500).json({
            success: false,
            error: "Summary service is not configured. Please contact support.",
          });
        }

        return res.status(503).json({
          success: false,
          error: summaryError.message,
        });
      }

      return res.status(500).json({
        success: false,
        error: "An unexpected error occurred while generating summary",
      });
    }
  } catch (error: any) {
    if (handleCastError(error, res)) return;
    next(error);
  }
};
