import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { addReferral, getReferrals } from "../controllers/referrals.controller";

const router = Router({ mergeParams: true });

router.post("/", authenticateJWT, addReferral);
router.get("/", authenticateJWT, getReferrals);

export default router;
