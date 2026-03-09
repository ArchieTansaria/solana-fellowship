import { Request, Response } from "express";
import prisma from "../prisma";
import { computeLaunchStatus } from "../utils/computeStatus";

export const purchaseToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const { walletAddress, amount, txSignature, referralCode } = req.body;

    if (!walletAddress || amount === undefined || !txSignature) {
      res.status(400).json({ error: "missing fields" });
      return;
    }

    if (amount <= 0) {
      res.status(400).json({ error: "amount must be greater than 0" });
      return;
    }

    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
      include: {
        purchases: true,
        tiers: {
          orderBy: { minAmount: "asc" },
        },
        whitelist: true,
      },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    const totalPurchased = launch.purchases.reduce((acc, p) => acc + p.amount, 0);
    const status = computeLaunchStatus(launch.totalSupply, totalPurchased, launch.startsAt, launch.endsAt);

    if (status !== "ACTIVE") {
      res.status(400).json({ error: `Launch is not active (current status: ${status})` });
      return;
    }

    const existingTx = await prisma.purchase.findUnique({
      where: { txSignature },
    });

    if (existingTx) {
      res.status(400).json({ error: "Duplicate txSignature" });
      return;
    }

    const userPurchases = launch.purchases.filter((p) => p.userId === userId);
    const userTotalPurchased = userPurchases.reduce((acc, p) => acc + p.amount, 0);

    if (userTotalPurchased + amount > launch.maxPerWallet) {
      res.status(400).json({ error: "Exceeds maxPerWallet per user limit" });
      return;
    }

    if (totalPurchased + amount > launch.totalSupply) {
      res.status(400).json({ error: "Exceeds totalSupply limit" });
      return;
    }

    if (launch.whitelist.length > 0) {
      const isWhitelisted = launch.whitelist.some((w) => w.address === walletAddress);
      if (!isWhitelisted) {
        res.status(400).json({ error: "Wallet address not in whitelist" });
        return;
      }
    }

    let totalCost = 0;
    let remainingAmount = amount;

    if (launch.tiers.length > 0) {
      for (const tier of launch.tiers) {
        if (remainingAmount <= 0) break;
        const capacity = tier.maxAmount - tier.minAmount;
        if (capacity > 0) {
          const usedFromTier = Math.min(remainingAmount, capacity);
          totalCost += usedFromTier * tier.pricePerToken;
          remainingAmount -= usedFromTier;
        }
      }
    }

    if (remainingAmount > 0) {
      totalCost += remainingAmount * launch.pricePerToken;
    }

    let discountApplied = false;
    let validReferral = null;

    if (referralCode) {
      const referral = await prisma.referralCode.findUnique({
        where: { launchId_code: { launchId, code: referralCode } },
      });

      if (!referral) {
        res.status(400).json({ error: "Invalid referral code" });
        return;
      }

      if (referral.usedCount >= referral.maxUses) {
        res.status(400).json({ error: "Referral code exhausted" });
        return;
      }

      validReferral = referral;
      const discountAmount = totalCost * (referral.discountPercent / 100);
      totalCost = Math.max(0, totalCost - discountAmount);
      discountApplied = true;
    }

    const purchase = await prisma.purchase.create({
      data: {
        walletAddress,
        amount,
        totalCost,
        txSignature,
        userId,
        launchId,
      },
    });

    if (discountApplied && validReferral) {
      await prisma.referralCode.update({
        where: { id: validReferral.id },
        data: {
          usedCount: { increment: 1 },
        },
      });
    }

    res.status(201).json(purchase);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;

    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
      include: {
        purchases: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    let purchasesToReturn = [];

    if (launch.creatorId === userId) {
      purchasesToReturn = launch.purchases;
    } else {
      purchasesToReturn = launch.purchases.filter((p) => p.userId === userId);
    }

    res.status(200).json({
      purchases: purchasesToReturn.map((p) => ({
        id: p.id,
        userId: p.userId,
        walletAddress: p.walletAddress,
        amount: p.amount,
        totalCost: p.totalCost,
        txSignature: p.txSignature,
        createdAt: p.createdAt,
      })),
      total: purchasesToReturn.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
