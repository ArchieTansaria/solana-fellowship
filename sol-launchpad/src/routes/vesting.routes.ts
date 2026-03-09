import { Router } from "express";
import { getVestingCalculation } from "../controllers/vesting.controller";

const router = Router({ mergeParams: true });

router.get("/", getVestingCalculation);

export default router;
