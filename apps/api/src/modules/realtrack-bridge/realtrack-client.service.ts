import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface RemoteListingCreateResult {
  id: string;
  raw: unknown;
}

@Injectable()
export class RealtrackClientService {
  private readonly logger = new Logger(RealtrackClientService.name);
  private readonly baseUrl = (
    process.env.REALTRACK_BRIDGE_API_URL ||
    process.env.REALTRACK_API_URL ||
    'http://localhost:4191/api'
  ).replace(/\/$/, '');
  // Reuse the existing RealTrack reader credentials unless dedicated bridge
  // credentials are supplied. RealTrack permissions still decide whether the
  // account may create listings or publish to eBay.
  private readonly email =
    process.env.REALTRACK_BRIDGE_EMAIL || process.env.REALTRACK_API_EMAIL;
  private readonly password =
    process.env.REALTRACK_BRIDGE_PASSWORD || process.env.REALTRACK_API_PASSWORD;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  async createListing(
    payload: Record<string, unknown>,
  ): Promise<RemoteListingCreateResult> {
    const raw = await this.request('/listings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const record = this.asRecord(raw);
    const id =
      this.stringValue(record?.id) ||
      this.stringValue(this.asRecord(record?.listing)?.id) ||
      this.stringValue(this.asRecord(record?.data)?.id);
    if (!id) {
      throw new BadGatewayException(
        'RealTrack created a listing but did not return its ID',
      );
    }
    return { id, raw };
  }

  async publishBatch(items: Array<Record<string, unknown>>) {
    return this.request('/channels/ebay/publish-batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  private async authenticate(retry = 0): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return;
    if (!this.email || !this.password) {
      throw new ServiceUnavailableException(
        'Set REALTRACK_API_EMAIL and REALTRACK_API_PASSWORD, or the REALTRACK_BRIDGE_* overrides, for the RealTrack account',
      );
    }

    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    }).catch((error: unknown) => {
      throw new ServiceUnavailableException(
        `Could not reach RealTrack: ${this.errorMessage(error)}`,
      );
    });

    const body = await this.readBody(response);
    if (!response.ok || !this.stringValue(this.asRecord(body)?.accessToken)) {
      if (retry < 1 && response.status >= 500) {
        this.accessToken = null;
        await this.authenticate(retry + 1);
        return;
      }
      throw new ServiceUnavailableException(
        `RealTrack authentication failed (${response.status})`,
      );
    }

    this.accessToken = this.stringValue(this.asRecord(body)?.accessToken)!;
    this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    this.logger.log('Authenticated to RealTrack bridge write account');
  }

  private async request(
    path: string,
    init: RequestInit,
    retry = 0,
  ): Promise<unknown> {
    await this.authenticate();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      throw new ServiceUnavailableException(
        `Could not reach RealTrack: ${this.errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = await this.readBody(response);
    if (response.status === 401 && retry < 1) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      return this.request(path, init, retry + 1);
    }
    if (!response.ok) {
      const detail = this.safeRemoteMessage(body);
      throw new BadGatewayException(
        `RealTrack API ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    return body;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private safeRemoteMessage(body: unknown): string {
    const record = this.asRecord(body);
    const message =
      this.stringValue(record?.message) ||
      this.stringValue(record?.error) ||
      (typeof body === 'string' ? body : '');
    return message.slice(0, 400);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'network error';
  }
}
