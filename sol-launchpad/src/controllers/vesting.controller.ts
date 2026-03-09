import { Request, Response } from "express";
import prisma from "../prisma";

export const getVestingCalculation = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const { walletAddress } = req.query;

    if (!walletAddress || typeof walletAddress !== "string") {
      res.status(400).json({ error: "walletAddress query parameter is required" });
      return;
    }

    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
      include: {
        purchases: {
          where: { walletAddress },
        },
        vesting: true,
      },
    });

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    const totalPurchased = launch.purchases.reduce((acc: any, p: any) => acc + p.amount, 0);

    if (!launch.vesting) {
      res.status(200).json({
        totalPurchased,
        tgeAmount: totalPurchased,
        cliffEndsAt: null,
        vestedAmount: totalPurchased,
        lockedAmount: 0,
        claimableAmount: totalPurchased,
      });
      return;
    }

    const { cliffDays, vestingDays, tgePercent } = launch.vesting;

    const tgeAmount = Math.floor(totalPurchased * (tgePercent / 100));
    
    const cliffEndsAt = new Date(launch.startsAt.getTime() + cliffDays * 24 * 60 * 60 * 1000);
    const vestingEndsAt = new Date(cliffEndsAt.getTime() + vestingDays * 24 * 60 * 60 * 1000);

    const now = new Date();
    
    let vestedAmount = 0;

    if (now < launch.startsAt) {
      vestedAmount = 0;
    } else if (now >= launch.startsAt && now < cliffEndsAt) {
      vestedAmount = tgeAmount;
    } else if (now >= cliffEndsAt && now < vestingEndsAt) {
      const remainingTokens = totalPurchased - tgeAmount;
      const totalVestingMs = vestingDays * 24 * 60 * 60 * 1000;
      const elapsedVestingMs = now.getTime() - cliffEndsAt.getTime();
      
      const linearlyVested = Math.floor(remainingTokens * (elapsedVestingMs / totalVestingMs));
      
      vestedAmount = tgeAmount + linearlyVested;
    } else if (now >= vestingEndsAt) {
      vestedAmount = totalPurchased;
    }

    const lockedAmount = totalPurchased - vestedAmount;
    const claimableAmount = Math.max(0, vestedAmount - tgeAmount);

    res.status(200).json({
      totalPurchased,
      tgeAmount,
      cliffEndsAt,
      vestedAmount,
      lockedAmount,
      claimableAmount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
