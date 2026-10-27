/**
 * Inclusive calendar-date range (YYYY-MM-DD) as a Prisma DateTime filter.
 * `to` covers the whole day, so `to=2026-10-27` includes 23:59:59 that day.
 */
export function dateRangeFilter(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lt?: Date } = {};
  if (from) filter.gte = new Date(`${from}T00:00:00Z`);
  if (to) {
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    filter.lt = end;
  }
  return filter;
}

export function pageInfo(pagination: { page: number; pageSize: number }, total: number) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    hasNextPage: pagination.page * pagination.pageSize < total,
    hasPreviousPage: pagination.page > 1,
  };
}
