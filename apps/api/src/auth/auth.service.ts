import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { SessionUser } from '@medicore/shared-types';
import { MAX_FAILED_LOGINS, LOCKOUT_MINUTES, SESSION_TTL_SECONDS } from '@medicore/shared-types';
import type { LoginRequestDto, RegisterOrganizationRequestDto } from '@medicore/validation';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountLocked, Conflict, Forbidden, InvalidCredentials, NotFound, Unauthenticated } from '../common/app-exception.js';
import { SYSTEM_ROLE_PERMISSIONS } from '../rbac/permission-catalog.js';
import { EMAIL_SENDER, type EmailSender } from './email.port.js';

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP baseline
  timeCost: 2,
  parallelism: 1,
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  // ── Registration & onboarding bootstrap ────────────────────────────────────

  /**
   * Registers the first user and their organization with a TRIAL subscription,
   * the default branch/warehouse, system roles, and org settings — one transaction.
   */
  async registerOrganization(dto: RegisterOrganizationRequestDto, meta: { ip?: string; ua?: string }) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw Conflict('DUPLICATE_ENTITY', 'An account with this email already exists — sign in instead');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON_OPTS);
    const slugBase = dto.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org';

    const created = await this.prisma.$transaction(async (tx) => {
      // Slug uniqueness under concurrency: retry a bounded number of times.
      let slug = slugBase;
      for (let attempt = 0; attempt < 5; attempt++) {
        const clash = await tx.organization.findUnique({ where: { slug } });
        if (!clash) break;
        slug = `${slugBase}-${randomBytes(2).toString('hex')}`;
      }

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(), // self-registered first user is trusted for now; verification flow still exists for invitees
        },
      });

      const org = await tx.organization.create({
        data: { name: dto.organizationName, slug },
      });

      const ownerRole = await tx.role.create({
        data: { organizationId: org.id, key: 'ORGANIZATION_OWNER', name: 'Owner', isSystem: true },
      });

      // Seed the standard organization roles with their explicit permission
      // sets (spec §4). Owner is created above; superadmin is a user flag.
      const permissionRows = await tx.permission.findMany({ select: { id: true, key: true } });
      const permissionByKey = new Map(permissionRows.map((p) => [p.key, p.id]));
      for (const [roleKey, permissionKeys] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
        if (roleKey === 'PLATFORM_SUPERADMIN') continue;
        await tx.role.create({
          data: {
            organizationId: org.id,
            key: roleKey,
            name: roleKey
              .replace(/^ORGANIZATION_/, '')
              .toLowerCase()
              .replace(/(^|_)([a-z])/g, (_, s: string, c: string) => `${s ? ' ' : ''}${c.toUpperCase()}`),
            isSystem: true,
            permissions: {
              create: permissionKeys
                .map((key) => permissionByKey.get(key))
                .filter((id): id is string => id !== undefined)
                .map((permissionId) => ({ permissionId })),
            },
          },
        });
      }

      await tx.organizationMembership.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          roleId: ownerRole.id,
          status: 'ACTIVE',
          isOwner: true,
          joinedAt: new Date(),
        },
      });

      const trialPlan = await tx.subscriptionPlan.findUnique({ where: { key: 'TRIAL' } });
      if (trialPlan) {
        const periodEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        await tx.subscription.create({
          data: {
            organizationId: org.id,
            planId: trialPlan.id,
            status: 'TRIALING',
            trialEndsAt: periodEnd,
            currentPeriodEnd: periodEnd,
          },
        });
      }

      await tx.branch.create({
        data: { organizationId: org.id, name: 'Main Branch', isDefault: true },
      });

      await tx.organizationSettings.create({
        data: { organizationId: org.id },
      });

      return { userId: user.id, organizationId: org.id, slug };
    });

    // Audit after commit: the audit writer uses a separate connection and
    // would otherwise race the uncommitted organization insert (FK violation).
    await this.audit.record({
      event: 'ORGANIZATION_CREATED',
      organizationId: created.organizationId,
      actorUserId: created.userId,
      entityType: 'Organization',
      entityId: created.organizationId,
      details: { name: dto.organizationName },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });

    return created;
  }

  // ── Login / logout / sessions ──────────────────────────────────────────────

  async login(dto: LoginRequestDto, meta: { ip?: string; ua?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      // Constant-shape failure; also record attempt for rate analysis.
      await this.prisma.loginAttempt.create({
        data: { email: dto.email, success: false, ipAddress: meta.ip, userAgent: meta.ua },
      });
      throw InvalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw AccountLocked(user.lockedUntil);
    }
    if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
      throw Forbidden('Account is suspended — contact your organization administrator');
    }

    const passwordOk = user.passwordHash
      ? await argon2.verify(user.passwordHash, dto.password)
      : false;

    if (!passwordOk) {
      const failedCount = user.failedLoginCount + 1;
      // Lock AFTER the configured number of failures: this attempt still
      // returns 401; the next attempt is rejected as locked (spec §4).
      const shouldLock = failedCount >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: shouldLock
          ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000), failedLoginCount: 0 }
          : { failedLoginCount: failedCount },
      });
      await this.prisma.loginAttempt.create({
        data: { email: dto.email, userId: user.id, success: false, ipAddress: meta.ip, userAgent: meta.ua },
      });
      await this.audit.record({
        event: 'USER_LOGIN_FAILURE',
        actorUserId: user.id,
        actorEmail: user.email,
        ipAddress: meta.ip,
        userAgent: meta.ua,
        details: { failedCount, locked: shouldLock },
      });
      throw InvalidCredentials();
    }

    // Success: reset counters, create session.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const token = newToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
        ipAddress: meta.ip,
        userAgent: meta.ua?.slice(0, 300),
      },
    });
    await this.prisma.loginAttempt.create({
      data: { email: dto.email, userId: user.id, success: true, ipAddress: meta.ip, userAgent: meta.ua },
    });
    await this.audit.record({
      event: 'USER_LOGIN_SUCCESS',
      actorUserId: user.id,
      actorEmail: user.email,
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });

    return { token, sessionId: session.id, userId: user.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  /** Session view for /auth/me — includes memberships and branch assignments. */
  async getSessionUser(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            organization: { select: { id: true, name: true } },
            role: { select: { name: true, key: true, permissions: { select: { permission: { select: { key: true } } } } } },
            branchAssignments: {
              include: { branch: { select: { id: true, name: true, code: true } } },
            },
          },
        },
      },
    });
    if (!user) throw Unauthenticated('User no longer exists');
    const allPermissionKeys = user.memberships.some((m) => m.isOwner)
      ? (await this.prisma.permission.findMany({ select: { key: true } })).map((p) => p.key)
      : [];

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformSuperadmin: user.isPlatformSuperadmin,
      memberships: user.memberships.map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        status: m.status,
        roleName: m.role?.name ?? 'Member',
        isOwner: m.isOwner,
        permissions: m.isOwner ? allPermissionKeys : (m.role?.permissions.map((rp) => rp.permission.key) ?? []),
        branches: m.branchAssignments.map((a) => ({
          id: a.branch.id,
          name: a.branch.name,
          code: a.branch.code,
        })),
      })),
    };
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ipAddress: true, userAgent: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw NotFound('Session not found');
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      event: 'SESSION_REVOKED',
      actorUserId: userId,
      entityType: 'Session',
      entityId: sessionId,
    });
  }

  // ── Password reset & email verification ────────────────────────────────────

  async requestPasswordReset(email: string, meta: { ip?: string; ua?: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Do not reveal whether the account exists; still record the event for the actor if it does.
    if (user) {
      const token = newToken();
      await this.prisma.authToken.create({
        data: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });
      await this.email.send({
        to: user.email,
        subject: 'MediCore password reset',
        body: `Reset your password with this single-use token (valid 1 hour):\n\n${token}`,
      });
      await this.audit.record({
        event: 'PASSWORD_RESET_REQUESTED',
        actorUserId: user.id,
        actorEmail: user.email,
        ipAddress: meta.ip,
      });
    }
  }

  async resetPassword(token: string, newPassword: string, meta: { ip?: string; ua?: string }): Promise<void> {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt !== null || record.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Reset link is invalid or has expired' });
    }
    if (!record.userId) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Reset link is invalid' });

    const passwordHash = await argon2.hash(newPassword, ARGON_OPTS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          passwordHistory: { create: { passwordHash } },
        },
      }),
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Revoke all sessions after a password reset (spec §28 access revocation).
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      event: 'PASSWORD_RESET_COMPLETED',
      actorUserId: record.userId,
      ipAddress: meta.ip,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.type !== 'EMAIL_VERIFICATION' || record.usedAt !== null || record.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Verification link is invalid or has expired' });
    }
    if (!record.userId) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Verification link is invalid' });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await this.audit.record({ event: 'EMAIL_VERIFIED', actorUserId: record.userId });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw Unauthenticated();
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw InvalidCredentials();
    const passwordHash = await argon2.hash(newPassword, ARGON_OPTS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordHistory: { create: { passwordHash } } },
    });
    await this.audit.record({ event: 'PASSWORD_CHANGED', actorUserId: userId, actorEmail: user.email });
  }

  // ── Invitations ────────────────────────────────────────────────────────────

  /** Creates (or re-invites) a user into an organization and issues the invite token. */
  async inviteMember(params: {
    organizationId: string;
    actorUserId: string;
    actorEmail: string;
    email: string;
    fullName: string;
    roleId: string | null;
    branchIds: string[];
  }): Promise<{ invitationEmailQueued: boolean; invitationToken?: string }> {
    const existingUser = await this.prisma.user.findUnique({ where: { email: params.email } });

    const membership = await this.prisma.$transaction(async (tx) => {
      let userId: string;
      if (!existingUser) {
        const user = await tx.user.create({
          data: {
            email: params.email,
            fullName: params.fullName,
            status: 'INVITED',
          },
        });
        userId = user.id;
      } else {
        userId = existingUser.id;
        // Refresh profile name if empty; keep existing credentials.
        if (!existingUser.fullName || existingUser.fullName.length === 0) {
          await tx.user.update({ where: { id: userId }, data: { fullName: params.fullName } });
        }
      }

      const current = await tx.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: params.organizationId, userId } },
      });
      if (current && current.status === 'ACTIVE') {
        throw Conflict('DUPLICATE_ENTITY', 'User is already an active member of this organization');
      }

      const membershipRow = current
        ? await tx.organizationMembership.update({
            where: { id: current.id },
            data: { status: 'INVITED', roleId: params.roleId, invitedAt: new Date() },
          })
        : await tx.organizationMembership.create({
            data: {
              organizationId: params.organizationId,
              userId,
              roleId: params.roleId,
              status: 'INVITED',
            },
          });

      if (params.branchIds.length > 0) {
        for (const branchId of params.branchIds) {
          await tx.userBranchAssignment.upsert({
            where: { membershipId_branchId: { membershipId: membershipRow.id, branchId } },
            create: { membershipId: membershipRow.id, branchId },
            update: {},
          });
        }
      }
      return membershipRow;
    });

    const token = newToken();
    await this.prisma.authToken.create({
      data: {
        userId: membership.userId,
        membershipId: membership.id,
        type: 'INVITATION',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.email.send({
      to: params.email,
      subject: "You've been invited to MediCore",
      body: `Accept your invitation with this single-use token (valid 7 days):\n\n${token}`,
    });

    await this.audit.record({
      event: 'USER_CREATED',
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      entityType: 'OrganizationMembership',
      entityId: membership.id,
      details: { invitedEmail: params.email, roleId: params.roleId },
    });

    // Honest contract: the console transport does not deliver email. In test
    // environments the raw token is returned so integration tests can complete
    // the acceptance flow; in other environments it is never exposed.
    if (process.env.NODE_ENV === 'test') {
      return { invitationEmailQueued: true, invitationToken: token };
    }
    return { invitationEmailQueued: true };
  }

  async acceptInvitation(token: string, password: string, fullName: string, meta: { ip?: string; ua?: string }) {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (
      !record ||
      record.type !== 'INVITATION' ||
      record.usedAt !== null ||
      record.expiresAt < new Date() ||
      !record.membershipId
    ) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invitation is invalid or has expired' });
    }
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { id: record.membershipId },
    });
    if (!membership) throw NotFound('Invitation not found');

    const passwordHash = await argon2.hash(password, ARGON_OPTS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: membership.userId },
        data: {
          passwordHash,
          fullName,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      }),
      this.prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      }),
      this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await this.audit.record({
      event: 'USER_REACTIVATED',
      organizationId: membership.organizationId,
      actorUserId: membership.userId,
      entityType: 'OrganizationMembership',
      entityId: membership.id,
      ipAddress: meta.ip,
    });
    return { organizationId: membership.organizationId, userId: membership.userId };
  }
}
