import express from "express";
import {
  createResource,
  getUserResources,
  getResourceById,
  updateResource,
  deleteResource,
  generateSummary,
  completeUpload,
} from "../controllers/resourceController";
import { initPdfUpload } from "../controllers/resourceController";

const router = express.Router();

router.route("/").get(getUserResources).post(createResource);
router.post("/upload/pdf/init", initPdfUpload);

router
  .route("/:id")
  .get(getResourceById)
  .patch(updateResource)
  .delete(deleteResource);

router.post("/:id/complete-upload", completeUpload);
router.post("/:id/summary", generateSummary);

export default router;
