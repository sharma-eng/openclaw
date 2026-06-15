import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { info, warn } from "openclaw/plugin-sdk/runtime-env";
import { isVapiConfigured, parseVapiConfig } from "./src/config.js";
import { VapiClient } from "./src/vapi-client.js";
import { VapiWebhookServer } from "./src/webhook-server.js";
import type { VapiWebhookMessage } from "./src/webhook-server.js";

// ---------------------------------------------------------------------------
// Runtime singleton
// ---------------------------------------------------------------------------

const RUNTIME_KEY = Symbol.for("openclaw.vapi.runtime");

interface VapiRuntime {
  client: VapiClient;
  webhookServer?: VapiWebhookServer;
}

function getGlobalRuntime(): VapiRuntime | undefined {
  return (globalThis as Record<symbol, unknown>)[RUNTIME_KEY] as
    | VapiRuntime
    | undefined;
}

function setGlobalRuntime(runtime: VapiRuntime | undefined): void {
  (globalThis as Record<symbol, unknown>)[RUNTIME_KEY] = runtime;
}

// ---------------------------------------------------------------------------
// Config schema with UI hints
// ---------------------------------------------------------------------------

const vapiConfigSchema = {
  parse(value: unknown) {
    return parseVapiConfig(value);
  },
  uiHints: {
    apiKey: {
      label: "Vapi API Key",
      help: "Your Vapi private API key from dashboard.vapi.ai → Account → API Keys.",
      sensitive: true,
      placeholder: "vapi_...",
    },
    assistantId: {
      label: "Assistant ID",
      help: "Default Vapi assistant ID used when initiating outbound calls.",
    },
    phoneNumberId: {
      label: "Phone Number ID",
      help: "Vapi phone number ID to use as the caller for outbound calls.",
    },
    agentId: {
      label: "Agent ID",
      help: "OpenClaw agent ID to route inbound Vapi call events to (e.g. your Emma agent).",
    },
    "webhook.enabled": {
      label: "Enable Webhook Server",
      help: "Start a local HTTP server so Vapi can deliver call events to this OpenClaw instance.",
    },
    "webhook.port": {
      label: "Webhook Port",
      help: "Port the webhook server listens on (default: 3011). Configure matching Server URL in Vapi.",
    },
    "webhook.path": {
      label: "Webhook Path",
      help: "HTTP path for the webhook endpoint (default: /vapi/webhook).",
    },
    "webhook.secret": {
      label: "Webhook Secret",
      help: "Optional bearer token Vapi sends for request verification.",
      sensitive: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default definePluginEntry({
  id: "vapi",
  name: "Vapi",
  description:
    "Vapi voice-calling plugin. Lets OpenClaw agents initiate and receive phone calls via Vapi's voice AI platform.",
  configSchema: vapiConfigSchema,

  register(api: OpenClawPluginApi) {
    if (!isVapiConfigured(api.pluginConfig)) {
      warn("Vapi plugin: no API key configured — skipping registration.");
      return;
    }

    const config = parseVapiConfig(api.pluginConfig);

    const ensureRuntime = (): VapiRuntime => {
      const existing = getGlobalRuntime();
      if (existing) return existing;
      const runtime: VapiRuntime = { client: new VapiClient(config.apiKey) };
      setGlobalRuntime(runtime);
      return runtime;
    };

    // -------------------------------------------------------------------------
    // Tool: vapi_call
    // Registered on Emma (or any agent with agentId) so the agent can
    // initiate, check, and end Vapi phone calls.
    // -------------------------------------------------------------------------

    api.registerTool({
      name: "vapi_call",
      label: "Vapi Voice Call",
      description:
        "Initiate, check status, or end a Vapi phone call. " +
        "Use action=initiate to start a call, action=status to poll it, action=end to hang up.",
      parameters: {
        type: "object",
        oneOf: [
          {
            description: "Initiate an outbound phone call via Vapi.",
            properties: {
              action: { type: "string", const: "initiate" },
              phoneNumber: {
                type: "string",
                description: "E.164 number to call, e.g. +15550001234",
              },
              assistantId: {
                type: "string",
                description:
                  "Vapi assistant ID to use (overrides plugin default).",
              },
              firstMessage: {
                type: "string",
                description:
                  "Override the assistant's opening spoken message.",
              },
            },
            required: ["action", "phoneNumber"],
            additionalProperties: false,
          },
          {
            description: "Check the status of an active or ended Vapi call.",
            properties: {
              action: { type: "string", const: "status" },
              callId: {
                type: "string",
                description: "Vapi call ID returned from initiate.",
              },
            },
            required: ["action", "callId"],
            additionalProperties: false,
          },
          {
            description: "End (hang up) an active Vapi call.",
            properties: {
              action: { type: "string", const: "end" },
              callId: {
                type: "string",
                description: "Vapi call ID to hang up.",
              },
            },
            required: ["action", "callId"],
            additionalProperties: false,
          },
        ],
      } as unknown as Parameters<typeof api.registerTool>[0]["parameters"],

      async execute(_toolCallId, params) {
        const { client } = ensureRuntime();
        const p = params as Record<string, unknown>;

        if (p["action"] === "initiate") {
          const phoneNumber = p["phoneNumber"] as string;
          const assistantId =
            (p["assistantId"] as string | undefined) ?? config.assistantId;
          const firstMessage = p["firstMessage"] as string | undefined;

          if (!assistantId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Cannot initiate call: no assistantId provided and no default configured in the Vapi plugin.",
                },
              ],
            };
          }

          const call = await client.createCall({
            assistantId,
            phoneNumberId: config.phoneNumberId,
            customer: { number: phoneNumber },
            assistantOverrides: firstMessage ? { firstMessage } : undefined,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `Call initiated — ID: ${call.id}, status: ${call.status}`,
              },
            ],
            details: call,
          };
        }

        if (p["action"] === "status") {
          const call = await client.getCall(p["callId"] as string);
          const detail = call.endedReason ? `, ended: ${call.endedReason}` : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `Call ${call.id}: ${call.status}${detail}`,
              },
            ],
            details: call,
          };
        }

        if (p["action"] === "end") {
          const callId = p["callId"] as string;
          await client.endCall(callId);
          return {
            content: [
              { type: "text" as const, text: `Call ${callId} ended.` },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown vapi_call action: ${String(p["action"])}`,
            },
          ],
        };
      },
    });

    // -------------------------------------------------------------------------
    // Gateway methods for CLI / programmatic access
    // -------------------------------------------------------------------------

    api.registerGatewayMethod(
      "vapi.call.initiate",
      async ({ params, respond }) => {
        const { client } = ensureRuntime();
        const p = params as Record<string, unknown>;
        const phoneNumber = p["phoneNumber"] as string | undefined;
        const assistantId =
          (p["assistantId"] as string | undefined) ?? config.assistantId;

        if (!phoneNumber) {
          respond(false, undefined, "phoneNumber is required");
          return;
        }
        if (!assistantId) {
          respond(false, undefined, "assistantId is required (or set a default in plugin config)");
          return;
        }

        const call = await client.createCall({
          assistantId,
          phoneNumberId: config.phoneNumberId,
          customer: { number: phoneNumber },
        });
        respond(true, call);
      },
      { scope: "operator.write" }
    );

    api.registerGatewayMethod(
      "vapi.call.status",
      async ({ params, respond }) => {
        const { client } = ensureRuntime();
        const callId = (params as Record<string, unknown>)["callId"] as
          | string
          | undefined;
        if (!callId) {
          respond(false, undefined, "callId is required");
          return;
        }
        const call = await client.getCall(callId);
        respond(true, call);
      },
      { scope: "operator.read" }
    );

    api.registerGatewayMethod(
      "vapi.call.end",
      async ({ params, respond }) => {
        const { client } = ensureRuntime();
        const callId = (params as Record<string, unknown>)["callId"] as
          | string
          | undefined;
        if (!callId) {
          respond(false, undefined, "callId is required");
          return;
        }
        await client.endCall(callId);
        respond(true, { callId });
      },
      { scope: "operator.write" }
    );

    api.registerGatewayMethod(
      "vapi.assistants.list",
      async ({ respond }) => {
        const { client } = ensureRuntime();
        const assistants = await client.listAssistants();
        respond(true, assistants);
      },
      { scope: "operator.read" }
    );

    api.registerGatewayMethod(
      "vapi.phone-numbers.list",
      async ({ respond }) => {
        const { client } = ensureRuntime();
        const numbers = await client.listPhoneNumbers();
        respond(true, numbers);
      },
      { scope: "operator.read" }
    );

    // -------------------------------------------------------------------------
    // Webhook service — routes Vapi call events to the configured agent (Emma)
    // -------------------------------------------------------------------------

    api.registerService({
      id: "vapi",

      async start() {
        if (!config.webhook.enabled) return;

        const runtime = ensureRuntime();

        const webhookServer = new VapiWebhookServer(
          config,
          async (message: VapiWebhookMessage) => {
            const agentId = config.agentId;

            switch (message.type) {
              // Vapi asking which assistant to use for this call.
              case "assistant-request": {
                if (config.assistantId) {
                  return { assistantId: config.assistantId };
                }
                return {};
              }

              // Call lifecycle events — log and let Vapi proceed.
              case "status-update":
              case "speech-update":
              case "transcript":
                if (agentId) {
                  info(
                    `Vapi event ${message.type} for call ${message.call?.id ?? "?"} → agent ${agentId}`
                  );
                }
                return {};

              // End-of-call report — useful for logging or memory.
              case "end-of-call-report": {
                if (agentId && message.summary) {
                  info(
                    `Vapi call ended (agent ${agentId}). Summary: ${message.summary}`
                  );
                }
                return {};
              }

              default:
                return {};
            }
          }
        );

        await webhookServer.start();
        runtime.webhookServer = webhookServer;

        info(
          `Vapi webhook ready at ${webhookServer.serverUrl}` +
            (config.agentId ? ` → agent ${config.agentId}` : "")
        );
      },

      async stop() {
        const runtime = getGlobalRuntime();
        if (runtime?.webhookServer) {
          await runtime.webhookServer.stop();
          runtime.webhookServer = undefined;
        }
        setGlobalRuntime(undefined);
      },
    });
  },
});
