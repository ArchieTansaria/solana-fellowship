import { Request, Response } from "express";
import prisma from "../prisma";
import { computeLaunchStatus } from "../utils/computeStatus";

export const createLaunch = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      symbol,
      totalSupply,
      pricePerToken,
      startsAt,
      endsAt,
      maxPerWallet,
      description,
      tiers,
      vesting,
    } = req.body;

    if (
      !name ||
      !symbol ||
      totalSupply === undefined ||
      pricePerToken === undefined ||
      !startsAt ||
      !endsAt ||
      maxPerWallet === undefined ||
      !description
    ) {
      res.status(400).json({ error: "missing fields" });
      return;
    }

    const userId = req.user!.userId;

    const launch = await prisma.launch.create({
      data: {
        name,
        symbol,
        totalSupply,
        pricePerToken,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        maxPerWallet,
        description,
        creatorId: userId,
        ...(tiers && tiers.length > 0 && {
          tiers: {
            create: tiers,
          },
        }),
        ...(vesting && {
          vesting: {
            create: vesting,
          },
        }),
      },
      include: {
        tiers: true,
        vesting: true,
        purchases: true,
      },
    });

    const totalPurchased = launch.purchases.reduce((acc: any, p: any) => acc + p.amount, 0);
    const status = computeLaunchStatus(launch.totalSupply, totalPurchased, launch.startsAt, launch.endsAt);

    res.status(201).json({
      ...launch,
      status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getLaunches = async (req: Request, res: Response): Promise<void> => {
  try {
    let page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    if (isNaN(page) || page < 1) page = 1;

    let limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    if (isNaN(limit) || limit < 1) limit = 10;

    const statusFilter = req.query.status as string | undefined;
    const skip = (page - 1) * limit;

    const allLaunches = await prisma.launch.findMany({
      include: {
        purchases: true,
      },
      orderBy: { startsAt: "desc" },
    });

    const computedLaunches = allLaunches.map((launch: any) => {
      const totalPurchased = launch.purchases.reduce((acc: any, p: any) => acc + p.amount, 0);
      const status = computeLaunchStatus(launch.totalSupply, totalPurchased, launch.startsAt, launch.endsAt);
      return { ...launch, status };
    });

    let filteredLaunches = computedLaunches;
    if (statusFilter) {
      filteredLaunches = computedLaunches.filter((l: any) => l.status === statusFilter);
    }

    const total = filteredLaunches.length;
    const paginatedLaunches = filteredLaunches.slice(skip, skip + limit);

    res.status(200).json({
      launches: paginatedLaunches,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getLaunchById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);

    const launch = await prisma.launch.findUnique({
      where: { id },
      include: {
        tiers: true,
        vesting: true,
        purchases: true,
      },
    });

    if (!launch) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const totalPurchased = launch.purchases.reduce((acc: any, p: any) => acc + p.amount, 0);
    const status = computeLaunchStatus(launch.totalSupply, totalPurchased, launch.startsAt, launch.endsAt);

    res.status(200).json({
      ...launch,
      status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateLaunch = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;

    const existingLaunch = await prisma.launch.findUnique({
      where: { id },
      include: { purchases: true },
    });

    if (!existingLaunch) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (existingLaunch.creatorId !== userId) {
      res.status(403).json({ error: "Forbidden: Not the creator" });
      return;
    }

    const {
      name,
      symbol,
      totalSupply,
      pricePerToken,
      startsAt,
      endsAt,
      maxPerWallet,
      description,
    } = req.body;

    const dataToUpdate: any = {};
    if (name) dataToUpdate.name = name;
    if (symbol) dataToUpdate.symbol = symbol;
    if (totalSupply !== undefined) dataToUpdate.totalSupply = totalSupply;
    if (pricePerToken !== undefined) dataToUpdate.pricePerToken = pricePerToken;
    if (startsAt) dataToUpdate.startsAt = new Date(startsAt);
    if (endsAt) dataToUpdate.endsAt = new Date(endsAt);
    if (maxPerWallet !== undefined) dataToUpdate.maxPerWallet = maxPerWallet;
    if (description) dataToUpdate.description = description;

    const updatedLaunch = await prisma.launch.update({
      where: { id },
      data: dataToUpdate,
      include: {
        purchases: true,
        tiers: true,
        vesting: true,
      },
    });

    const totalPurchased = updatedLaunch.purchases.reduce((acc: any, p: any) => acc + p.amount, 0);
    const status = computeLaunchStatus(updatedLaunch.totalSupply, totalPurchased, updatedLaunch.startsAt, updatedLaunch.endsAt);

    res.status(200).json({
      ...updatedLaunch,
      status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
