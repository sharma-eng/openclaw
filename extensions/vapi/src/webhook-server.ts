import * as http from "node:http";
import { info, warn } from "openclaw/plugin-sdk/runtime-env";
import type { VapiResolvedConfig } from "./config.js";

export interface VapiWebhookMessage {
  type: string;
  call?: {
    id: string;
    status: string;
    assistantId?: string;
    customer?: { number: string };
  };
  transcript?: string;
  toolCallList?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  endedReason?: string;
  summary?: string;
  [key: string]: unknown;
}

export type VapiEventHandler = (
  message: VapiWebhookMessage
) => Promise<Record<string, unknown> | void>;

export class VapiWebhookServer {
  private server: http.Server | null = null;

  constructor(
    private readonly config: VapiResolvedConfig,
    private readonly onEvent: VapiEventHandler
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.on("error", reject);
      this.server.listen(this.config.webhook.port, () => {
        info(`Vapi webhook server listening on port ${this.config.webhook.port} at ${this.config.webhook.path}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  get serverUrl(): string {
    return `http://localhost:${this.config.webhook.port}${this.config.webhook.path}`;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    if (req.url !== this.config.webhook.path) {
      res.writeHead(404).end();
      return;
    }

    // Verify bearer token when a secret is configured.
    const secret = this.config.webhook.secret;
    if (secret) {
      const auth = req.headers.authorization ?? "";
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
      if (provided !== secret) {
        res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    const body = await this.readBody(req);
    if (body === null) {
      res.writeHead(400).end(JSON.stringify({ error: "Failed to read body" }));
      return;
    }

    let payload: { message?: VapiWebhookMessage };
    try {
      payload = JSON.parse(body) as { message?: VapiWebhookMessage };
    } catch {
      res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const message = payload.message;
    if (!message?.type) {
      res.writeHead(400).end(JSON.stringify({ error: "Missing message.type" }));
      return;
    }

    try {
      const result = await this.onEvent(message);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result ?? {}));
    } catch (err) {
      warn(`Vapi webhook handler error for ${message.type}: ${String(err)}`);
      res.writeHead(500).end(JSON.stringify({ error: "Internal error" }));
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => resolve(null));
    });
  }
}
