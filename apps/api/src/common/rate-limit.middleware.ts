import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory sliding-window rate limiter (Phase 12 baseline). For multi-instance
 * deployments this must move to Redis (recorded in DECISIONS.md as part of the
 * Phase 12 Redis adoption).
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private static readonly WINDOW_MS = 60_000;
  private static readonly MAX_REQUESTS = 20;
  private readonly hits = new Map<string, number[]>();

  use(req: Request, res: Response, next: NextFunction): void {
    const key = `${req.ip ?? 'unknown'}:${req.path}`;
    const now = Date.now();
    const windowStart = now - RateLimitMiddleware.WINDOW_MS;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= RateLimitMiddleware.MAX_REQUESTS) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests — try again in a minute',
        },
      });
      return;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    // Bounded memory: purge stale keys occasionally.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => t <= windowStart)) this.hits.delete(k);
      }
    }
    next();
  }
}
