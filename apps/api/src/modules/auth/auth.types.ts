import type { AuthRole } from './auth.service';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: AuthRole;
  sellerIds: string[];
}
