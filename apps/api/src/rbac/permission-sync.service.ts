import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from './permission-catalog.js';

/**
 * Syncs the permission catalog into the DB at every boot (idempotent) and
 * grants newly catalogued permissions to existing system roles. System roles
 * are locked against edits, so the grant is purely additive.
 */
@Injectable()
export class PermissionSyncService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const p of PERMISSIONS) {
        await this.prisma.permission.upsert({
          where: { key: p.key },
          create: { key: p.key, description: p.description },
          update: { description: p.description },
        });
      }
      const idByKey = new Map((await this.prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
      const roles = await this.prisma.role.findMany({ where: { isSystem: true }, select: { id: true, key: true } });
      for (const role of roles) {
        const keys = role.key ? SYSTEM_ROLE_PERMISSIONS[role.key] : undefined;
        if (!keys || keys.length === 0) continue;
        await this.prisma.rolePermission.createMany({
          data: keys.flatMap((k) => (idByKey.has(k) ? [{ roleId: role.id, permissionId: idByKey.get(k)! }] : [])),
          skipDuplicates: true,
        });
      }
    } catch {
      // DB may not be migrated during first bootstrap; `prisma db seed` also seeds.
    }
  }
}
