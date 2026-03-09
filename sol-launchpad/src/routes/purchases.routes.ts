import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { purchaseToken, getPurchases } from "../controllers/purchases.controller";

const router = Router({ mergeParams: true });

router.post("/purchase", authenticateJWT, purchaseToken);
router.get("/purchases", authenticateJWT, getPurchases);

export default router;
