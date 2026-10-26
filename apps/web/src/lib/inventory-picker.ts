'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export interface Warehouse {
  id: string;
  name: string;
  branchId: string;
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string;
  genericName: string | null;
}

export interface BatchOption {
  id: string;
  batchNumber: string;
  expiryDate: string;
  status: string;
  mrp: string;
  product: { name: string; sku: string };
  balances: Array<{ quantity: string }>;
  /** Computed by useInventoryPicker: Σ balances (on-hand quantity). */
  onHand?: number;
}

/**
 * Shared cascading selection for inventory operations pages:
 * warehouse → product → batches (with on-hand quantity).
 */
export function useInventoryPicker() {
  const { tenant } = useSession();
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const branches = await api<Array<{ id: string; warehouses: Array<{ id: string; name: string }> }>>(
        '/organizations/branches',
      );
      return branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, branchId: b.id }))) as Warehouse[];
    },
  });

  const products = useQuery({
    queryKey: ['product-options'],
    queryFn: () =>
      api<{ items: Array<{ id: string; name: string; sku: string; genericName: string | null }> }>(
        '/catalog/products?page=1&pageSize=200&status=ACTIVE',
      ),
    retry: false,
  });

  const batches = useQuery({
    queryKey: ['batch-options', warehouseId, productId],
    queryFn: () =>
      api<{ items: BatchOption[] }>(`/inventory/batches?page=1&pageSize=200&warehouseId=${warehouseId}&productId=${productId}`),
    enabled: Boolean(warehouseId && productId),
    retry: false,
  });

  const productOptions: ProductOption[] = useMemo(
    () =>
      (products.data?.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        genericName: p.genericName,
      })),
    [products.data],
  );

  const batchOptions: BatchOption[] = useMemo(
    () =>
      (batches.data?.items ?? []).map((b) => ({
        ...b,
        onHand: b.balances.reduce((s, x) => s + Number(x.quantity), 0),
      })),
    [batches.data],
  );

  return {
    tenant,
    warehouses,
    products: { ...products, options: productOptions },
    batches: { ...batches, options: batchOptions },
    warehouseId,
    setWarehouseId,
    productId,
    setProductId,
    selectedProduct: productOptions.find((p) => p.id === productId) ?? null,
  };
}
