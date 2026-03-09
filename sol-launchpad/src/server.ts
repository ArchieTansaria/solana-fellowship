import express, { Request, Response } from "express";
import authRoutes from "./routes/auth.routes";
import launchesRoutes from "./routes/launches.routes";
import whitelistRoutes from "./routes/whitelist.routes";
import referralsRoutes from "./routes/referrals.routes";
import purchasesRoutes from "./routes/purchases.routes";
import vestingRoutes from "./routes/vesting.routes";

const app = express();
app.use(express.json());

// Main Routes
app.use("/api/auth", authRoutes);
app.use("/api/launches", launchesRoutes);

// Nested routes via router nesting approach
app.use("/api/launches/:id/whitelist", whitelistRoutes);
app.use("/api/launches/:id/referrals", referralsRoutes);
app.use("/api/launches/:id", purchasesRoutes);
app.use("/api/launches/:id/vesting", vestingRoutes);

app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});