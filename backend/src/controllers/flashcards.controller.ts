import type { Request, Response } from "express";
import mongoose from "mongoose";

import { FlashcardSetModel } from "../models/FlashcardSet";
import { FlashcardModel } from "../models/Flashcard";
import { Resource } from "../models/Resource";
import { FlashcardStudySessionModel } from "../models/FlashcardStudySession";
import { generateFlashcardsFromText } from "../services/flashcardsGenerator";

const getOwnerId = (req: Request): string | undefined =>
  req.user?.id ?? req.ownerId;

export const generateFlashcardsSet = async (req: Request, res: Response) => {
  let ownerIdForRollback: mongoose.Types.ObjectId | null = null;
  let createdSetIdForRollback: mongoose.Types.ObjectId | null = null;

  try {
    // Flashcards currently rely on req.ownerId (dev placeholder).
    // In real auth, this would come from a decoded JWT / session.
    const ownerIdStr = getOwnerId(req);

    if (!ownerIdStr) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    // Flashcards models expect ownerId to be a Mongo ObjectId.
    if (!mongoose.Types.ObjectId.isValid(ownerIdStr)) {
      return res
        .status(400)
        .json({ message: "Invalid ownerId (ObjectId expected)." });
    }

    const ownerId = new mongoose.Types.ObjectId(ownerIdStr);

    // Save for rollback cleanup in case we fail later.
    ownerIdForRollback = ownerId;

    const body = req.body as {
      resourceId?: string;
      title?: string;
      count?: number;
    };

    // resourceId is required and must be a valid ObjectId string.
    const resourceIdStr = body.resourceId;
    if (!resourceIdStr || !mongoose.Types.ObjectId.isValid(resourceIdStr)) {
      return res
        .status(400)
        .json({ message: "resourceId is required (ObjectId)." });
    }
    const resourceId = new mongoose.Types.ObjectId(resourceIdStr);

    const countRaw = typeof body.count === "number" ? body.count : 10;
    const count = Math.max(1, Math.min(30, Math.floor(countRaw)));

    const resourceByOwner = await Resource.findOne({
      _id: resourceIdStr,
      ownerId,
    })
      .select({ textContent: 1 })
      .lean();

    if (!resourceByOwner) {
      return res.status(404).json({ message: "Resource not found." });
    }

    // generate flashcards from the resource textContent.
    const text = (resourceByOwner.textContent ?? "").trim();
    if (!text) {
      return res.status(400).json({
        message:
          "Resource textContent is empty. Upload/paste text into the resource first.",
      });
    }

    const lastSet = await FlashcardSetModel.findOne({ ownerId, resourceId })
      .sort({ sequenceNumber: -1 })
      .select({ sequenceNumber: 1 })
      .lean();

    const nextSeq = (lastSet?.sequenceNumber ?? 0) + 1;
    const title = (body.title && body.title.trim()) || `Flashcards ${nextSeq}`;

    const set = await FlashcardSetModel.create({
      ownerId,
      resourceId,
      sequenceNumber: nextSeq,
      title,
    });

    createdSetIdForRollback = set._id;

    const cards = await generateFlashcardsFromText({ text, count });

    const docs = cards.map((c) => ({
      ownerId,
      setId: set._id,
      front: c.front,
      back: c.back,
      explanation: c.explanation,
    }));

    await FlashcardModel.insertMany(docs);

    return res.status(201).json({
      setId: set._id.toString(),
      title,
      sequenceNumber: nextSeq,
      cardsCount: docs.length,
    });
  } catch (e) {
    if (ownerIdForRollback && createdSetIdForRollback) {
      try {
        await FlashcardModel.deleteMany({
          ownerId: ownerIdForRollback,
          setId: createdSetIdForRollback,
        });

        await FlashcardSetModel.deleteOne({
          _id: createdSetIdForRollback,
          ownerId: ownerIdForRollback,
        });
      } catch {}
    }

    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ message: msg });
  }
};

export const listFlashcardsSetsByResource = async (
  req: Request,
  res: Response
) => {
  try {
    const ownerIdStr = getOwnerId(req);
    if (!ownerIdStr) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    if (!mongoose.Types.ObjectId.isValid(ownerIdStr)) {
      return res.status(400).json({ message: "Invalid ownerId." });
    }

    const ownerId = new mongoose.Types.ObjectId(ownerIdStr);

    const resourceIdStr = req.params.resourceId;
    if (!resourceIdStr || !mongoose.Types.ObjectId.isValid(resourceIdStr)) {
      return res.status(400).json({ message: "Invalid resourceId." });
    }

    const resourceId = new mongoose.Types.ObjectId(resourceIdStr);

    const sets = await FlashcardSetModel.find({ ownerId, resourceId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(
      sets.map((s) => ({
        id: s._id.toString(),
        title: s.title,
        sequenceNumber: s.sequenceNumber,
        createdAt: s.createdAt,
      }))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ message: msg });
  }
};

export const listAllFlashcardSets = async (req: Request, res: Response) => {
  try {
    const ownerIdStr = getOwnerId(req);
    if (!ownerIdStr) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    if (!mongoose.Types.ObjectId.isValid(ownerIdStr)) {
      return res.status(400).json({ message: "Invalid ownerId." });
    }

    const ownerId = new mongoose.Types.ObjectId(ownerIdStr);

    const sets = await FlashcardSetModel.find({ ownerId })
      .sort({ createdAt: -1 })
      .lean();

    const resourceIds = Array.from(
      new Set(sets.map((set) => set.resourceId.toString()))
    );
    const resources = await Resource.find({ _id: { $in: resourceIds } })
      .select({ title: 1 })
      .lean();

    const titlesById = new Map(
      resources.map((r) => [r._id.toString(), r.title])
    );

    const counts = await Promise.all(
      sets.map((set) =>
        FlashcardModel.countDocuments({ setId: set._id, ownerId }).then(
          (count) => ({
            setId: set._id.toString(),
            count,
          })
        )
      )
    );

    const countsById = new Map(counts.map((item) => [item.setId, item.count]));

    return res.json(
      sets.map((set) => ({
        id: set._id.toString(),
        title: set.title,
        sequenceNumber: set.sequenceNumber,
        createdAt: set.createdAt,
        resourceId: set.resourceId.toString(),
        resourceTitle:
          titlesById.get(set.resourceId.toString()) || "Untitled Resource",
        cardsCount: countsById.get(set._id.toString()) ?? 0,
      }))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ message: msg });
  }
};

export const getFlashcardsSet = async (req: Request, res: Response) => {
  try {
    const ownerIdStr = getOwnerId(req);
    if (!ownerIdStr) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    if (!mongoose.Types.ObjectId.isValid(ownerIdStr)) {
      return res.status(400).json({ message: "Invalid ownerId." });
    }

    const ownerId = new mongoose.Types.ObjectId(ownerIdStr);

    const setIdStr = req.params.setId;
    if (!setIdStr || !mongoose.Types.ObjectId.isValid(setIdStr)) {
      return res.status(400).json({ message: "Invalid setId." });
    }

    const setId = new mongoose.Types.ObjectId(setIdStr);

    const set = await FlashcardSetModel.findOne({ _id: setId, ownerId }).lean();
    if (!set)
      return res.status(404).json({ message: "Flashcard set not found." });

    const cards = await FlashcardModel.find({ setId, ownerId })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      id: set._id.toString(),
      title: set.title,
      sequenceNumber: set.sequenceNumber,
      createdAt: set.createdAt,
      cards: cards.map((c) => ({
        id: c._id.toString(),
        front: c.front,
        back: c.back,
        explanation: c.explanation,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ message: msg });
  }
};

export const deleteFlashcardsSet = async (req: Request, res: Response) => {
  try {
    const ownerIdStr = getOwnerId(req);
    if (!ownerIdStr) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    if (!mongoose.Types.ObjectId.isValid(ownerIdStr)) {
      return res.status(400).json({ message: "Invalid ownerId." });
    }

    const ownerId = new mongoose.Types.ObjectId(ownerIdStr);

    const setIdStr = req.params.setId;
    if (!setIdStr || !mongoose.Types.ObjectId.isValid(setIdStr)) {
      return res.status(400).json({ message: "Invalid setId." });
    }

    const setId = new mongoose.Types.ObjectId(setIdStr);

    const set = await FlashcardSetModel.findOne({ _id: setId, ownerId }).lean();
    if (!set)
      return res.status(404).json({ message: "Flashcard set not found." });

    await FlashcardModel.deleteMany({ setId, ownerId });
    await FlashcardSetModel.deleteOne({ _id: setId, ownerId });

    return res.status(204).send();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ message: msg });
  }
};

export const recordFlashcardStudySession = async (
  req: Request,
  res: Response
) => {
  try {
    const ownerIdStr = getOwnerId(req);
    if (!ownerIdStr) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    if (!mongoose.Types.ObjectId.isValid(ownerIdStr)) {
      return res.status(400).json({ message: "Invalid ownerId." });
    }

    const ownerId = new mongoose.Types.ObjectId(ownerIdStr);

    const setIdStr = req.params.setId;
    if (!setIdStr || !mongoose.Types.ObjectId.isValid(setIdStr)) {
      return res.status(400).json({ message: "Invalid setId." });
    }
    const setId = new mongoose.Types.ObjectId(setIdStr);

    const { cardsReviewed, startedAt, finishedAt } = req.body as {
      cardsReviewed?: number;
      startedAt?: string;
      finishedAt?: string;
    };

    if (typeof cardsReviewed !== "number" || cardsReviewed < 0) {
      return res
        .status(400)
        .json({ message: "cardsReviewed must be a non-negative number." });
    }

    if (!startedAt || !finishedAt) {
      return res
        .status(400)
        .json({ message: "startedAt and finishedAt are required." });
    }

    const started = new Date(startedAt);
    const finished = new Date(finishedAt);
    if (Number.isNaN(started.getTime()) || Number.isNaN(finished.getTime())) {
      return res.status(400).json({ message: "Invalid date format." });
    }

    const set = await FlashcardSetModel.findOne({ _id: setId, ownerId }).lean();
    if (!set) {
      return res.status(404).json({ message: "Flashcard set not found." });
    }

    const session = await FlashcardStudySessionModel.create({
      ownerId,
      setId,
      cardsReviewed,
      startedAt: started,
      finishedAt: finished,
    });

    return res.status(201).json({
      sessionId: session._id.toString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ message: msg });
  }
};
