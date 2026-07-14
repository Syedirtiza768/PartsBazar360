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
  private readonly baseUrl = 'https://mhn.realtrackapp.com/api';
  private readonly email = 'api-published-listings@realtrack.local';
  private readonly password = 'Ebay$321';
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return;
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

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`RealTrack API error: ${response.statusText}`);
      }

      const data = await response.json();
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

