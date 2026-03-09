import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { createLaunch, getLaunches, getLaunchById, updateLaunch } from "../controllers/launches.controller";

const router = Router();

router.post("/", authenticateJWT, createLaunch);
router.get("/", getLaunches);
router.get("/:id", getLaunchById);
router.put("/:id", authenticateJWT, updateLaunch);

export default router;
