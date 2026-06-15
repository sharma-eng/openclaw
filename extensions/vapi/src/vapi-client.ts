const VAPI_BASE_URL = "https://api.vapi.ai";

export interface VapiCall {
  id: string;
  status: "queued" | "ringing" | "in-progress" | "forwarding" | "ended";
  type: "inboundPhoneCall" | "outboundPhoneCall" | "webCall";
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  transcript?: string;
  summary?: string;
  customer?: { number: string };
  assistantId?: string;
  phoneNumberId?: string;
}

export interface VapiAssistant {
  id: string;
  name?: string;
  firstMessage?: string;
  model?: { provider: string; model: string };
  voice?: { provider: string; voiceId: string };
}

export interface VapiPhoneNumber {
  id: string;
  number: string;
  name?: string;
  assistantId?: string;
}

export interface VapiCreateCallParams {
  assistantId?: string;
  assistant?: Record<string, unknown>;
  assistantOverrides?: Record<string, unknown>;
  phoneNumberId?: string;
  customer: { number: string; name?: string };
}

export class VapiClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${VAPI_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Vapi API ${method} ${path} → ${response.status}: ${text}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json() as Promise<T>;
    }
    return undefined as unknown as T;
  }

  createCall(params: VapiCreateCallParams): Promise<VapiCall> {
    return this.request<VapiCall>("POST", "/call", params);
  }

  getCall(callId: string): Promise<VapiCall> {
    return this.request<VapiCall>("GET", `/call/${callId}`);
  }

  /** Hangs up an in-progress call. */
  endCall(callId: string): Promise<void> {
    return this.request<void>("DELETE", `/call/${callId}`);
  }

  listCalls(limit = 20): Promise<VapiCall[]> {
    return this.request<VapiCall[]>("GET", `/call?limit=${limit}`);
  }

  getAssistant(assistantId: string): Promise<VapiAssistant> {
    return this.request<VapiAssistant>("GET", `/assistant/${assistantId}`);
  }

  listAssistants(): Promise<VapiAssistant[]> {
    return this.request<VapiAssistant[]>("GET", "/assistant");
  }

  listPhoneNumbers(): Promise<VapiPhoneNumber[]> {
    return this.request<VapiPhoneNumber[]>("GET", "/phone-number");
  }
}
