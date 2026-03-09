import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { addWhitelist, getWhitelist, removeWhitelist } from "../controllers/whitelist.controller";

const router = Router({ mergeParams: true });

router.post("/", authenticateJWT, addWhitelist);
router.get("/", authenticateJWT, getWhitelist);
router.delete("/:address", authenticateJWT, removeWhitelist);

export default router;
