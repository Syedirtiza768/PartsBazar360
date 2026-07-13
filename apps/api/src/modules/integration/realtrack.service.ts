import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RealTrackService {
  private readonly logger = new Logger(RealTrackService.name);
  private readonly baseUrl = 'https://mhn.realtrackapp.com/api';
  private readonly email = 'api-published-listings@realtrack.local';
  private readonly password = 'Ebay$321';
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  async authenticate(): Promise<void> {
    // Basic check to see if token is still valid (assuming 24h expiry)
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
      // Set expiry to 23 hours from now to be safe
      this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
      this.logger.log('Successfully authenticated with RealTrack API');
    } catch (error) {
      this.logger.error(`Authentication error: ${error.message}`, error.stack);
      throw error;
    }
  }

  async fetchListings(page: number = 1, limit: number = 200, storeId?: string): Promise<any[]> {
    await this.authenticate();
    this.logger.log(`Fetching RealTrack listings page ${page} (limit: ${limit})`);
    
    try {
      const url = new URL(`${this.baseUrl}/published-listings`);
      url.searchParams.append('page', page.toString());
      url.searchParams.append('limit', limit.toString());
      if (storeId) {
        url.searchParams.append('storeId', storeId);
      }

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
      return data.items || [];
    } catch (error) {
      this.logger.error(`Failed to fetch listings: ${error.message}`, error.stack);
      throw error;
    }
  }
}

