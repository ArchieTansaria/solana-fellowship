import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number };
    }
  }
}

export const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const secret = process.env.JWT_SECRET || "default_secret";
    const decoded = jwt.verify(token, secret) as { userId: number };
    req.user = { userId: decoded.userId };
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
};
