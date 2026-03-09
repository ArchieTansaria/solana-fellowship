import { Request, Response } from "express";
import prisma from "../prisma";

export const addReferral = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const { code, discountPercent, maxUses } = req.body;

    if (!code || discountPercent === undefined || maxUses === undefined) {
      res.status(400).json({ error: "missing fields" });
      return;
    }

    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    if (launch.creatorId !== userId) {
      res.status(403).json({ error: "Forbidden: Not the creator" });
      return;
    }

    const existingReferral = await prisma.referralCode.findUnique({
      where: { launchId_code: { launchId, code } },
    });

    if (existingReferral) {
      res.status(409).json({ error: "Referral code already exists for this launch" });
      return;
    }

    const referral = await prisma.referralCode.create({
      data: {
        code,
        discountPercent,
        maxUses,
        usedCount: 0,
        launchId,
      },
      select: {
        id: true,
        code: true,
        discountPercent: true,
        maxUses: true,
        usedCount: true,
      },
    });

    res.status(201).json(referral);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getReferrals = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;

    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    if (launch.creatorId !== userId) {
      res.status(403).json({ error: "Forbidden: Not the creator" });
      return;
    }

    const referrals = await prisma.referralCode.findMany({
      where: { launchId },
      select: {
        id: true,
        code: true,
        discountPercent: true,
        maxUses: true,
        usedCount: true,
      },
    });

    res.status(200).json({ referrals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
