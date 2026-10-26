/**
 * Idempotent database seed: permission catalog, subscription plans, and an
 * optional bootstrap superadmin (env SUPERADMIN_EMAILS, password via env or
 * printed once). Development rate-master seeds arrive with the tax module.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from '../src/rbac/permission-catalog.js';

const prisma = new PrismaClient();

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function seedPermissions(): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, description: p.description },
      update: { description: p.description },
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions`);
}

interface PlanDef {
  key: string;
  name: string;
  description: string;
  limits: Record<string, unknown>;
}

const PLANS: PlanDef[] = [
  {
    key: 'TRIAL',
    name: 'Free Trial',
    description: '14-day full-feature trial',
    limits: { maxBranches: 1, maxUsers: 3, maxWarehouses: 1, monthlyInvoiceLimit: 100, storageMb: 512, apiAccess: false, modules: ['catalog', 'inventory', 'pos'], reportRetentionDays: 30 },
  },
  {
    key: 'STARTER',
    name: 'Starter',
    description: 'Single-shop pharmacy',
    limits: { maxBranches: 1, maxUsers: 5, maxWarehouses: 1, monthlyInvoiceLimit: 2000, storageMb: 2048, apiAccess: false, modules: ['catalog', 'inventory', 'pos'], reportRetentionDays: 90 },
  },
  {
    key: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Growing retail with multiple counters',
    limits: { maxBranches: 2, maxUsers: 15, maxWarehouses: 3, monthlyInvoiceLimit: 20000, storageMb: 10240, apiAccess: true, modules: ['catalog', 'inventory', 'pos', 'purchases', 'returns'], reportRetentionDays: 365 },
  },
  {
    key: 'BUSINESS',
    name: 'Business',
    description: 'Multi-branch retail and distribution',
    limits: { maxBranches: 10, maxUsers: 50, maxWarehouses: 20, monthlyInvoiceLimit: 200000, storageMb: 51200, apiAccess: true, modules: ['catalog', 'inventory', 'pos', 'purchases', 'returns', 'wholesale', 'accounting'], reportRetentionDays: 730 },
  },
  {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Unlimited scale with integrations',
    limits: { maxBranches: -1, maxUsers: -1, maxWarehouses: -1, monthlyInvoiceLimit: -1, storageMb: -1, apiAccess: true, modules: ['*'], reportRetentionDays: 2555 },
  },
];

async function seedPlans(): Promise<void> {
  for (const plan of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      create: plan,
      update: { name: plan.name, description: plan.description, limits: plan.limits },
    });
  }
  console.log(`Seeded ${PLANS.length} subscription plans`);
}

async function seedSuperadmin(): Promise<void> {
  const emails = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (emails.length === 0) {
    console.log('SUPERADMIN_EMAILS not set — skipping superadmin bootstrap');
    return;
  }
  const providedPassword = process.env.SUPERADMIN_PASSWORD;
  for (const email of emails) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing?.isPlatformSuperadmin) {
      console.log(`Superadmin ${email} already exists`);
      continue;
    }
    const tempPassword = providedPassword ?? randomBytes(12).toString('base64url');
    const passwordHash = await argon2.hash(tempPassword, ARGON_OPTS);
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isPlatformSuperadmin: true, passwordHash, status: 'ACTIVE', emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
      });
    } else {
      await prisma.user.create({
        data: { email, fullName: 'Platform Administrator', passwordHash, isPlatformSuperadmin: true, status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
    }
    if (!providedPassword) {
      console.log(`Created superadmin ${email} with temporary password: ${tempPassword}`);
    } else {
      console.log(`Created/updated superadmin ${email} with provided password`);
    }
  }
}

async function main(): Promise<void> {
  await seedPermissions();
  await seedPlans();
  await seedSuperadmin();
}

main()
  .then(() => {
    console.log('Seed complete');
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
