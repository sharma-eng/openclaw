import {
  buildSecretInputSchema,
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "openclaw/plugin-sdk/secret-input";
import { z } from "zod";

export const VapiPluginConfigSchema = z.object({
  apiKey: buildSecretInputSchema(),
  assistantId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  // OpenClaw agent ID (e.g. Emma's agent ID) that handles inbound call events.
  agentId: z.string().optional(),
  webhook: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().int().min(1).max(65535).default(3011),
      path: z.string().default("/vapi/webhook"),
      secret: buildSecretInputSchema().optional(),
    })
    .optional(),
});

export type VapiPluginConfig = z.infer<typeof VapiPluginConfigSchema>;

export interface VapiResolvedConfig {
  apiKey: string;
  assistantId: string | undefined;
  phoneNumberId: string | undefined;
  agentId: string | undefined;
  webhook: {
    enabled: boolean;
    port: number;
    path: string;
    secret: string | undefined;
  };
}

export function parseVapiConfig(raw: unknown): VapiResolvedConfig {
  const config = VapiPluginConfigSchema.parse(raw);

  const apiKey = normalizeResolvedSecretInputString({ value: config.apiKey, path: "apiKey" });
  if (!apiKey) {
    throw new Error("Vapi plugin: apiKey is required but was not resolved.");
  }

  const wh = config.webhook;
  const webhookSecret = wh?.secret
    ? normalizeResolvedSecretInputString({ value: wh.secret, path: "webhook.secret" })
    : undefined;

  return {
    apiKey,
    assistantId: config.assistantId,
    phoneNumberId: config.phoneNumberId,
    agentId: config.agentId,
    webhook: {
      enabled: wh?.enabled ?? false,
      port: wh?.port ?? 3011,
      path: wh?.path ?? "/vapi/webhook",
      secret: webhookSecret ?? undefined,
    },
  };
}

export function isVapiConfigured(raw: unknown): boolean {
  try {
    const parsed = VapiPluginConfigSchema.safeParse(raw);
    if (!parsed.success) return false;
    return hasConfiguredSecretInput(parsed.data.apiKey);
  } catch {
    return false;
  }
}
