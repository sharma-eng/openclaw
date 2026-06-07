// Resolves and validates Canvas LMS plugin configuration.
import { z } from "zod";
import type { CanvasPluginConfig } from "./types.js";

const configSchema = z.object({
  apiUrl: z.string().url(),
  apiToken: z.string().min(1),
  sessionKey: z.string().min(1),
  deadlineWarningHours: z.number().positive().default(48),
  pollIntervalMinutes: z.number().positive().default(15),
});

export function resolveCanvasConfig(raw: unknown): CanvasPluginConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `[canvas-lms] invalid config: ${result.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  return result.data;
}
