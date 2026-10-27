import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  acceptInvitationRequestSchema,
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerOrganizationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from '@medicore/validation';
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '@medicore/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Public } from './public.decorator.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { AuthService } from './auth.service.js';

/**
 * Authentication endpoints. Public endpoints are marked @Public() — the global
 * SessionGuard authenticates the rest (me, logout, sessions, password change).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(req: Request) {
    return { ip: req.ip, ua: req.headers['user-agent'] };
  }

  private setSessionCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerOrganizationRequestSchema)) dto: typeof registerOrganizationRequestSchema._output,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.registerOrganization(dto, this.meta(req));
    // Auto-login the founder into their new organization.
    const session = await this.auth.login({ email: dto.email, password: dto.password }, this.meta(req));
    this.setSessionCookie(res, session.token);
    return result;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) dto: typeof loginRequestSchema._output,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, this.meta(req));
    this.setSessionCookie(res, result.token);
    return { userId: result.userId };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.principal.sessionId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/api/v1' });
  }

  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    return this.auth.getSessionUser(req.principal.userId);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) dto: typeof forgotPasswordRequestSchema._output,
    @Req() req: Request,
  ) {
    await this.auth.requestPasswordReset(dto.email, this.meta(req));
    // Always the same response shape — never reveals whether the account exists.
    return { accepted: true };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) dto: typeof resetPasswordRequestSchema._output,
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(dto.token, dto.password, this.meta(req));
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailRequestSchema)) dto: typeof verifyEmailRequestSchema._output,
  ) {
    await this.auth.verifyEmail(dto.token);
  }

  @Post('email/verify/resend')
  @HttpCode(HttpStatus.OK)
  resendEmailVerification(@Req() req: AuthenticatedRequest) {
    return this.auth.resendEmailVerification(req.principal.userId);
  }

  @Public()
  @Get('invitations/:token')
  describeInvitation(@Param('token') token: string) {
    return this.auth.describeInvitation(token);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) dto: typeof changePasswordRequestSchema._output,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.auth.changePassword(req.principal.userId, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) dto: typeof acceptInvitationRequestSchema._output,
    @Req() req: Request,
  ) {
    // Client signs in explicitly after acceptance; no session is minted here.
    return this.auth.acceptInvitation(dto.token, dto.password, dto.fullName, this.meta(req));
  }

  @Get('sessions')
  listSessions(@Req() req: AuthenticatedRequest) {
    return this.auth.listSessions(req.principal.userId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.auth.revokeSession(req.principal.userId, id);
  }
}
