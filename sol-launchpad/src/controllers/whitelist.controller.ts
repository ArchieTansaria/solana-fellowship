import { Request, Response } from "express";
import prisma from "../prisma";

export const addWhitelist = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const { addresses } = req.body;

    if (!addresses || !Array.isArray(addresses)) {
      res.status(400).json({ error: "Addresses array is required" });
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

    const existingWhitelists = await prisma.whitelist.findMany({
      where: { launchId },
    });
    const existingAddresses = new Set(existingWhitelists.map((w: any) => w.address));

    const newAddresses = addresses.filter((address) => !existingAddresses.has(address));

    if (newAddresses.length > 0) {
      await prisma.whitelist.createMany({
        data: newAddresses.map((address) => ({
          address,
          launchId,
        })),
        skipDuplicates: true,
      });
    }

    const total = existingAddresses.size + newAddresses.length;

    res.status(201).json({
      added: newAddresses.length,
      total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getWhitelist = async (req: Request, res: Response): Promise<void> => {
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

    const whitelists = await prisma.whitelist.findMany({
      where: { launchId },
    });

    res.status(200).json({
      addresses: whitelists.map((w: any) => w.address),
      total: whitelists.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const removeWhitelist = async (req: Request, res: Response): Promise<void> => {
  try {
    const launchId = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const { address } = req.params;

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

    const existingWhitelist = await prisma.whitelist.findUnique({
      where: { launchId_address: { launchId, address: address as string } },
    });

    if (!existingWhitelist) {
      res.status(404).json({ error: "Address not found in whitelist" });
      return;
    }

    await prisma.whitelist.delete({
      where: { launchId_address: { launchId, address: address as string } },
    });

    res.status(200).json({ removed: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
