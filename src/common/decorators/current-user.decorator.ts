import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  /** LOCAL MongoDB user id (not the Clerk id). */
  sub: string;
  email: string;
  roles: string[];
  partnerId?: string;
  /** Clerk user id (`user_...`) the request was authenticated as. */
  clerkUserId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
