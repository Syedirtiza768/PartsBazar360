import type {
  OpenRouterMessage,
  OpenRouterRequest,
  OpenRouterResponse,
  ModelConfig,
  ModelUsageRecord,
  PipelineStage,
} from './types';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const REFERER = 'https://partsbazar360.com';
const APP_TITLE = 'PartsBazar360 Listing Pipeline';

export interface CallOptions {
  model: ModelConfig;
  stage: PipelineStage;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: {
    type: 'json_object' | 'json_schema';
    json_schema?: unknown;
  };
  maxRetries?: number;
}

export interface CallResult {
  content: string;
  usage: ModelUsageRecord;
  raw: OpenRouterResponse;
}

/**
 * Thin wrapper around the OpenRouter chat completions API.
 * Handles retries, error classification, and cost tracking.
 */
export class OpenRouterClient {
  private apiKey: string;
  private totalCost = 0;
  private callLog: ModelUsageRecord[] = [];

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
    this.apiKey = apiKey;
  }

  async call(opts: CallOptions): Promise<CallResult> {
    const maxRetries = opts.maxRetries ?? 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.doCall(opts);
      } catch (err) {
        lastError = err as Error;
        const isRetryable = this.isRetryable(err as Error);
        if (!isRetryable || attempt >= maxRetries) break;

        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error(
      `OpenRouter call failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }

  private async doCall(opts: CallOptions): Promise<CallResult> {
    const body: OpenRouterRequest = {
      model: opts.model.id,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 4096,
    };

    if (opts.responseFormat) {
      body.response_format = opts.responseFormat;
    }

    const res = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': REFERER,
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      const status = res.status;

      if (status === 429) {
        throw new RetryableError(`Rate limited: ${text}`);
      }
      if (status === 502 || status === 503) {
        throw new RetryableError(`Server error ${status}: ${text}`);
      }
      throw new Error(`OpenRouter ${status}: ${text}`);
    }

    const data = (await res.json()) as OpenRouterResponse;
    const msg = data.choices?.[0]?.message;

    const content = msg?.content?.trim() || msg?.reasoning?.trim() || '';
    if (!content) {
      throw new Error('Empty response from OpenRouter');
    }

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const cost =
      (inputTokens * opts.model.inputCostPer1M) / 1_000_000 +
      (outputTokens * opts.model.outputCostPer1M) / 1_000_000;

    const usage: ModelUsageRecord = {
      stage: opts.stage,
      openRouterModelId: opts.model.id,
      reasonSelected: `Pipeline stage: ${opts.stage}`,
      inputTokens,
      outputTokens,
      estimatedCostUsd: cost,
    };

    this.totalCost += cost;
    this.callLog.push(usage);

    return { content, usage, raw: data };
  }

  private isRetryable(err: Error): boolean {
    if (err instanceof RetryableError) return true;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('timeout') ||
      msg.includes('econnreset')
    );
  }

  /** Strip markdown fences and extract JSON from model output. */
  static extractJson(text: string): unknown {
    let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
    return JSON.parse(cleaned);
  }

  getCallLog(): ModelUsageRecord[] {
    return [...this.callLog];
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  reset(): void {
    this.totalCost = 0;
    this.callLog = [];
  }
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}
