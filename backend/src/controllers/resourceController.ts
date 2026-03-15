import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Resource } from "../models/Resource";
import { LIMITS } from "../config/constants";
import {
  validateTitle,
  validateTextContent,
  validateTags,
  parseTags,
  normalizeText,
} from "../utils/validation";
import { generateSummaryFromText } from "../services/summaryGenerator";

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

    const deletedResource = await Resource.findOneAndDelete({
      _id: id,
      ownerId,
    });

    if (!deletedResource) {
      return res.status(404).json({
        success: false,
        error: "Resource not found",
      });
    }

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
