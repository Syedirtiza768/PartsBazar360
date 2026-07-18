import { Injectable, Logger } from '@nestjs/common';

export interface FetchListingsOptions {
  page?: number;
  limit?: number;
  storeId?: string;
  marketplaceId?: string;
  status?: string;
  search?: string;
}

export interface FetchListingsResult {
  items: any[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class RealTrackService {
  private readonly logger = new Logger(RealTrackService.name);
  private readonly baseUrl = (process.env.REALTRACK_API_URL || 'https://mhn.realtrackapp.com/api').replace(/\/$/, '');
  private readonly email = process.env.REALTRACK_API_EMAIL;
  private readonly password = process.env.REALTRACK_API_PASSWORD;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return;
    }

    if (!this.email || !this.password) {
      throw new Error('REALTRACK_API_EMAIL and REALTRACK_API_PASSWORD are required');
    }
    this.logger.log('Authenticating with RealTrack API...');
    try {
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password }),
      });

      if (!response.ok) {
        throw new Error(`Auth failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.accessToken = data.accessToken;
      this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
      this.logger.log('Successfully authenticated with RealTrack API');
    } catch (error) {
      this.logger.error(`Authentication error: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async requestJson(path: string, retry = 0): Promise<any> {
    await this.authenticate();
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
    });
    if (response.status === 401 && retry < 1) {
      this.accessToken = null;
      this.tokenExpiry = null;
      return this.requestJson(path, retry + 1);
    }
    if (response.status === 429 && retry < 5) {
      const retryAfter = Number(response.headers.get('retry-after')) || 2 ** retry;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30, retryAfter) * 1000));
      return this.requestJson(path, retry + 1);
    }
    if (response.status >= 500 && retry < 4) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, 2 ** retry) * 1000));
      return this.requestJson(path, retry + 1);
    }
    if (!response.ok) throw new Error(`RealTrack API ${response.status}: ${response.statusText}`);
    return response.json();
  }

  async fetchListings(options: FetchListingsOptions = {}): Promise<FetchListingsResult> {
    await this.authenticate();

    const { page = 1, limit = 200, storeId, marketplaceId, status, search } = options;

    this.logger.log(`Fetching RealTrack listings page ${page} (limit: ${limit}, storeId: ${storeId || 'all'}, marketplaceId: ${marketplaceId || 'all'})`);

    try {
      const url = new URL(`${this.baseUrl}/published-listings`);
      url.searchParams.append('page', page.toString());
      url.searchParams.append('limit', limit.toString());
      if (storeId) url.searchParams.append('storeId', storeId);
      if (marketplaceId) url.searchParams.append('marketplaceId', marketplaceId);
      if (status) url.searchParams.append('status', status);
      if (search) url.searchParams.append('search', search);

      const data = await this.requestJson(`${url.pathname}${url.search}`);
      return {
        items: data.items || [],
        total: data.total || 0,
        page: data.page || page,
        limit: data.limit || limit,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch listings: ${error.message}`, error.stack);
      throw error;
    }
  }

  async fetchListingDetail(storeId: string, listingId: string): Promise<any> {
    return this.requestJson(`/stores/${encodeURIComponent(storeId)}/listings/published/${encodeURIComponent(listingId)}`);
  }

  async fetchAllListings(options: FetchListingsOptions = {}): Promise<any[]> {
    const allItems: any[] = [];
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await this.fetchListings({ ...options, page: currentPage });
      allItems.push(...result.items);

      this.logger.log(`Fetched ${allItems.length}/${result.total} listings`);

      if (result.items.length === 0 || allItems.length >= result.total) {
        hasMore = false;
      } else {
        currentPage++;
      }
    }

    return allItems;
  }
}
