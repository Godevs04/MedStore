import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';

/**
 * Platform-scope guard (spec §23): only platform superadmins pass. Used for
 * tenant administration endpoints. Does NOT grant access to tenant business
 * data — platform support access is a separate controlled workflow.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal?.isPlatformSuperadmin) {
      throw new ForbiddenException('Platform administrator access required');
    }
    return true;
  }
}
