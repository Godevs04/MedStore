import type { Prisma } from '@prisma/client';

/**
 * The transaction-scoped Prisma client passed to service helpers. Same shape
 * as Prisma.TransactionClient; aliased for clarity in the inventory service.
 */
export type TenantPrisma = Omit<Prisma.TransactionClient, '$transaction'>;
