import { Router, type IRouter } from "express";
import { GetBotOverviewResponse } from "@workspace/api-zod";
import { getBotOverview } from "../lib/moderation/discord-bot";

const router: IRouter = Router();

router.get("/bot/overview", (_req, res): void => {
  res.json(GetBotOverviewResponse.parse(getBotOverview()));
});

export default router;
