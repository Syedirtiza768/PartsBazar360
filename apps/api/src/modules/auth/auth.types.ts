import type { AuthRole } from './auth.service';

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
  role: AuthRole;
  sellerIds: string[];
}
