import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.module.js';
import { Unauthenticated } from '../common/app-exception.js';
import { SESSION_COOKIE_NAME } from '@medicore/shared-types';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export interface AuthenticatedRequest extends Request {
  principal: {
    userId: string;
    sessionId: string;
    email: string;
    fullName: string;
    isPlatformSuperadmin: boolean;
  };
}

/**
 * Authenticates via opaque session cookie; loads the principal onto the request.
 * Session token is random 32 bytes; only its SHA-256 is persisted (spec §28).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractSessionToken(request);
    if (!token) throw Unauthenticated();

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
      throw Unauthenticated('Session invalid or expired');
    }
    if (session.user.status !== 'ACTIVE') {
      throw Unauthenticated('Account is not active');
    }

    // Sliding session refresh: extend if more than 1 day has passed since lastSeen.
    const now = new Date();
    if (now.getTime() - session.lastSeenAt.getTime() > 24 * 60 * 60 * 1000) {
      const newExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, expiresAt: newExpiry },
      });
    }

    (request as AuthenticatedRequest).principal = {
      userId: session.userId,
      sessionId: session.id,
      email: session.user.email,
      fullName: session.user.fullName,
      isPlatformSuperadmin: session.user.isPlatformSuperadmin,
    };
    return true;
  }
}

export function extractSessionToken(request: Request): string | null {
  const cookieToken = (request.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;
  // Authorization: Bearer <session-token> for API clients/scripts.
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}
