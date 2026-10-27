/**
 * Populates a local development API with a realistic demo pharmacy so every
 * screen has data for walkthroughs and user-guide screenshots. Creates a new
 * organisation on each run (unique e-mail) and prints the login.
 *
 * Run (API must be running): pnpm --filter @medicore/api exec tsx scripts/demo-data.ts
 * Override target with DEMO_API_URL (default http://localhost:3001).
 */
const BASE = process.env.DEMO_API_URL ?? 'http://localhost:3001';
const stamp = Date.now().toString(36);
const EMAIL = `owner.${stamp}@sanjeevani.test`;
const PASSWORD = 'Sanjeevani2026';

let cookie = '';
let org = '';

async function call(path: string, body?: unknown, method?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (org) headers['x-organization-id'] = org;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const ok = res.status < 300;
  console.log(`${ok ? '✓' : '✗'} ${method ?? (body !== undefined ? 'POST' : 'GET')} ${path} → ${res.status}${ok ? '' : ` ${JSON.stringify(json?.error ?? json).slice(0, 200)}`}`);
  if (path === '/auth/login' && ok) cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return json;
}

const day = (offset: number): string => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function main(): Promise<void> {
  await call('/auth/register', { email: EMAIL, password: PASSWORD, fullName: 'Ravi Kulkarni', organizationName: 'Sanjeevani Pharmacy' });
  await call('/auth/login', { email: EMAIL, password: PASSWORD });
  const me = await call('/auth/me');
  org = me.memberships[0].organizationId;

  await call(
    '/organizations',
    {
      addressLine1: 'Shop 4, Health Plaza, FC Road',
      city: 'Pune',
      stateCode: '27',
      pinCode: '411005',
      contactPhone: '9822012345',
      contactEmail: 'contact@sanjeevani.test',
      gstRegistrationStatus: 'REGULAR',
      gstin: '27AAPFU0939F1ZV',
      pan: 'AAPFU0939F',
    },
    'PATCH',
  );
  const branches = await call('/organizations/branches');
  const branchId = branches[0].id;
  const main = await call(`/organizations/branches/${branchId}/warehouses`, { name: 'Main Store', isDefault: true });
  const cold = await call(`/organizations/branches/${branchId}/warehouses`, { name: 'Cold Room' });
  await call(`/organizations/branches/${branchId}/counters`, { name: 'Counter 1' });
  await call('/organizations/setup-complete', {});

  await call('/catalog/tax-rates/load-standard', {});
  const rates = await call('/catalog/tax-rates');
  const hsns = new Set((Array.isArray(rates) ? rates : rates?.items ?? []).map((r: { hsnCode: string }) => r.hsnCode));
  for (const [hsnCode, half, description] of [
    ['3004', '2.50', 'Medicaments in measured doses'],
    ['3304', '9.00', 'Beauty and skin-care preparations'],
    ['9025', '9.00', 'Thermometers'],
  ] as const) {
    if (!hsns.has(hsnCode)) await call('/catalog/tax-rates', { hsnCode, description, cgstPercent: half, sgstPercent: half, effectiveFrom: '2025-09-22' });
  }

  const cat = async (name: string) => (await call('/catalog/categories', { name }))?.id;
  const catAnti = await cat('Antibiotics');
  const catPain = await cat('Pain & fever');
  const catGastro = await cat('Gastro');
  const catDiab = await cat('Diabetes care');
  const catDevices = await cat('Devices');
  const catSkin = await cat('Skin care');
  const mfr = async (name: string) => (await call('/catalog/manufacturers', { name }))?.id;
  const cipla = await mfr('Cipla Ltd');
  const micro = await mfr('Micro Labs Ltd');
  const sun = await mfr('Sun Pharmaceutical Industries');
  const sanofi = await mfr('Sanofi India');
  const dr = await mfr('Dr. Morepen');

  const defs = [
    { key: 'azi', name: 'Azithral 500 Tablet', sku: 'AZI-500', genericName: 'Azithromycin', dosageForm: 'TABLET', strength: '500mg', packSize: '1x5', hsnCode: '3004', mrp: '119.50', purchasePrice: '82.00', sellingPrice: '112.00', prescriptionClass: 'PRESCRIPTION_ONLY', categoryId: catAnti, manufacturerId: cipla, rackLocation: 'A1', reorderLevel: 40, barcodes: ['8901234500011'] },
    { key: 'dolo', name: 'Dolo 650 Tablet', sku: 'DOLO-650', genericName: 'Paracetamol', dosageForm: 'TABLET', strength: '650mg', packSize: '1x15', hsnCode: '3004', mrp: '33.60', purchasePrice: '22.40', sellingPrice: '31.00', prescriptionClass: 'OTC', categoryId: catPain, manufacturerId: micro, rackLocation: 'B2', reorderLevel: 100, barcodes: ['8901234500028'] },
    { key: 'pan', name: 'Pan 40 Tablet', sku: 'PAN-40', genericName: 'Pantoprazole', dosageForm: 'TABLET', strength: '40mg', packSize: '1x15', hsnCode: '3004', mrp: '171.00', purchasePrice: '118.00', sellingPrice: '160.00', prescriptionClass: 'PRESCRIPTION_ONLY', categoryId: catGastro, manufacturerId: sun, rackLocation: 'C1', reorderLevel: 30, barcodes: ['8901234500035'] },
    { key: 'cet', name: 'Okacet 10 Tablet', sku: 'OKA-10', genericName: 'Cetirizine', dosageForm: 'TABLET', strength: '10mg', packSize: '1x10', hsnCode: '3004', mrp: '18.90', purchasePrice: '11.50', sellingPrice: '18.00', prescriptionClass: 'OTC', categoryId: catPain, manufacturerId: cipla, rackLocation: 'B3', reorderLevel: 60, barcodes: ['8901234500042'] },
    { key: 'ins', name: 'Lantus Solostar Pen', sku: 'LANTUS-100', genericName: 'Insulin Glargine', dosageForm: 'INJECTION', strength: '100IU/ml', packSize: '3ml pen', hsnCode: '3004', mrp: '780.00', purchasePrice: '610.00', sellingPrice: '760.00', prescriptionClass: 'PRESCRIPTION_ONLY', categoryId: catDiab, manufacturerId: sanofi, requiresRefrigeration: true, storageInstructions: 'Store at 2–8 °C. Do not freeze.', rackLocation: 'FRIDGE-1', reorderLevel: 10, barcodes: ['8901234500059'] },
    { key: 'alp', name: 'Alprax 0.5 Tablet', sku: 'ALP-05', genericName: 'Alprazolam', dosageForm: 'TABLET', strength: '0.5mg', packSize: '1x15', hsnCode: '3004', mrp: '42.00', purchasePrice: '27.00', sellingPrice: '40.00', prescriptionClass: 'SCHEDULE_H1', categoryId: catPain, manufacturerId: sun, rackLocation: 'H1-LOCK', reorderLevel: 20, barcodes: ['8901234500066'] },
    { key: 'thermo', name: 'Dr. Morepen Digital Thermometer', sku: 'MT-101', dosageForm: null, hsnCode: '9025', mrp: '299.00', purchasePrice: '160.00', sellingPrice: '249.00', prescriptionClass: 'OTC', categoryId: catDevices, manufacturerId: dr, rackLocation: 'D1', reorderLevel: 5, barcodes: ['8901234500073'] },
    { key: 'cream', name: 'Cetaphil Moisturising Cream 80g', sku: 'CET-80', dosageForm: 'CREAM', hsnCode: '3304', mrp: '425.00', purchasePrice: '300.00', sellingPrice: '399.00', prescriptionClass: 'OTC', categoryId: catSkin, rackLocation: 'E2', reorderLevel: 8, barcodes: ['8901234500080'] },
  ];
  const p: Record<string, string> = {};
  for (const { key, ...body } of defs) {
    const created = await call('/catalog/products', Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)));
    if (created?.id) p[key] = created.id;
  }

  const opening = async (key: string, batchNumber: string, expiryDays: number, quantity: string, purchaseRate: string, mrp: string, warehouseId = main.id) =>
    call('/inventory/batches', { productId: p[key], warehouseId, batchNumber, expiryDate: day(expiryDays), quantity, purchaseRate, mrp, sourceDocument: 'OPENING-STOCK' });
  const bAzi1 = await opening('azi', 'AZ24117', 40, '60', '82.00', '119.50');
  await opening('azi', 'AZ25032', 420, '120', '82.00', '119.50');
  await opening('dolo', 'DL25A09', 520, '400', '22.40', '33.60');
  await opening('dolo', 'DL24K02', 20, '30', '22.40', '33.60');
  const bPan = await opening('pan', 'PN25B14', 610, '150', '118.00', '171.00');
  await opening('cet', 'OK25C07', 75, '18', '11.50', '18.90');
  await opening('ins', 'LN25J01', 240, '24', '610.00', '780.00', cold.id);
  await opening('alp', 'AP25D21', 380, '60', '27.00', '42.00');
  await opening('thermo', 'MT2501', 1500, '12', '160.00', '299.00');
  const bCream = await opening('cream', 'CT25H05', 700, '10', '300.00', '425.00');
  const bExpired = await opening('dolo', 'DL24C01', 2, '25', '22.40', '33.60');

  const vendor1 = await call('/partners/vendors', { legalName: 'MedSource Distributors Pvt Ltd', gstin: '27MSDPS1234K1Z9', stateCode: '27', creditDays: 30, creditLimit: '300000.00' });
  const vendor2 = await call('/partners/vendors', { legalName: 'Pune Pharma Agencies', stateCode: '27', creditDays: 15, creditLimit: '100000.00' });
  const vendor3 = await call('/partners/vendors', { legalName: 'Karnataka Medico Wholesale', stateCode: '29', creditDays: 45 });

  const cust = async (name: string, phone: string, creditLimit?: string, creditDays?: number) =>
    call('/partners/customers', { name, phone, ...(creditLimit ? { creditLimit, creditDays } : {}) });
  const c1 = await cust('Dr. Sharma Clinic', '9822012345', '25000.00', 15);
  const c2 = await cust('Anita Deshpande', '9850011223');
  const c3 = await cust('Suresh Patil', '9767012399', '5000.00', 30);
  await cust('Meera Joshi', '9923456781');
  await cust('Shree Nursing Home', '9011223344', '50000.00', 30);

  // Procure-to-pay
  const po = await call('/purchasing/purchase-orders', {
    vendorId: vendor1.id,
    lines: [
      { productId: p.azi, quantity: '100', unitPrice: '82.00' },
      { productId: p.pan, quantity: '60', unitPrice: '118.00' },
      { productId: p.cet, quantity: '120', unitPrice: '11.50' },
    ],
  });
  await call(`/purchasing/purchase-orders/${po.id}/action`, { action: 'send' });
  await call(`/purchasing/purchase-orders/${po.id}/action`, { action: 'confirm' });
  const grn = await call('/purchasing/goods-receipts', {
    vendorId: vendor1.id,
    poId: po.id,
    warehouseId: main.id,
    lines: [
      { productId: p.azi, poLineId: po.lines[0].id, batchNumber: 'AZ25061', expiryDate: day(540), quantity: '100', purchaseRate: '82.00', mrp: '119.50' },
      { productId: p.cet, poLineId: po.lines[2].id, batchNumber: 'OK25F11', expiryDate: day(600), quantity: '120', purchaseRate: '11.50', mrp: '18.90' },
    ],
  });
  const supInv = await call('/purchasing/invoices', {
    vendorId: vendor1.id,
    invoiceNumber: 'MSD/2026/4471',
    invoiceDate: day(0),
    grnId: grn.id,
    lines: [
      { productId: p.azi, quantity: '100', unitCost: '82.00' },
      { productId: p.cet, quantity: '120', unitCost: '11.50' },
    ],
  });
  await call('/purchasing/payments', { vendorId: vendor1.id, amount: '5000.00', method: 'BANK', reference: 'NEFT-0091', allocations: [{ invoiceId: supInv.id, amount: '5000.00' }] });
  const po2 = await call('/purchasing/purchase-orders', { vendorId: vendor2.id, lines: [{ productId: p.dolo, quantity: '300', unitPrice: '22.40' }, { productId: p.ins, quantity: '12', unitPrice: '610.00' }] });
  await call(`/purchasing/purchase-orders/${po2.id}/action`, { action: 'send' });
  await call('/purchasing/purchase-orders', { vendorId: vendor3.id, lines: [{ productId: p.thermo, quantity: '20', unitPrice: '160.00' }] });

  // Order-to-cash
  const sale = async (body: Record<string, unknown>) => call('/sales/invoices', { warehouseId: main.id, idempotencyKey: `demo-${stamp}-${Math.random().toString(36).slice(2, 10)}`, ...body });
  const s1 = await sale({ customerId: c1.id, lines: [{ productId: p.azi, quantity: '4', unitPrice: '112.00' }, { productId: p.dolo, quantity: '10', unitPrice: '31.00' }], payments: [{ method: 'CASH', amount: '500.00' }, { method: 'UPI', amount: '258.00', reference: '612345678901' }] });
  await sale({ walkInName: 'Walk-in patient', lines: [{ productId: p.cet, quantity: '2', unitPrice: '18.00' }, { productId: p.dolo, quantity: '5', unitPrice: '31.00' }], payments: [{ method: 'CASH', amount: '191.00' }] });
  await sale({ customerId: c2.id, lines: [{ productId: p.pan, quantity: '2', unitPrice: '160.00' }, { productId: p.thermo, quantity: '1', unitPrice: '249.00' }], payments: [{ method: 'CARD', amount: '569.00', reference: '4417' }] });
  await sale({ customerId: c3.id, lines: [{ productId: p.dolo, quantity: '20', unitPrice: '31.00' }, { productId: p.cream, quantity: '1', unitPrice: '399.00' }], payments: [{ method: 'CREDIT', amount: '1019.00' }] });
  await sale({
    customerId: c2.id,
    lines: [{ productId: p.alp, quantity: '15', unitPrice: '40.00' }],
    payments: [{ method: 'UPI', amount: '600.00', reference: '612345670022' }],
    prescription: { patientName: 'Anita Deshpande', patientPhone: '9850011223', prescriberName: 'Dr. R. Mehta', prescriberRegNo: 'MMC 2010/12345', prescriberAddress: 'Mehta Clinic, JM Road, Pune' },
  });
  await sale({ customerId: c1.id, lines: [{ productId: p.azi, quantity: '10', unitPrice: '112.00' }, { productId: p.pan, quantity: '5', unitPrice: '160.00' }], payments: [{ method: 'CREDIT', amount: '1920.00' }] });
  await sale({ walkInName: 'Rahul', lines: [{ productId: p.dolo, quantity: '3', unitPrice: '31.00' }], payments: [{ method: 'CASH', amount: '93.00' }] });

  const line = s1?.invoice?.lines?.find((l: { productId: string }) => l.productId === p.dolo) ?? s1?.invoice?.lines?.[0];
  if (s1?.invoice?.id && line) await call('/sales/returns', { invoiceId: s1.invoice.id, reason: 'Patient bought extra strip by mistake', refundMethod: 'CASH', lines: [{ invoiceLineId: line.id, quantity: '2', restock: true }] });
  await call('/sales/receipts', { customerId: c1.id, amount: '1000.00', method: 'UPI', reference: '612345670099' });

  // Inventory operations
  if (bCream?.id) await call('/inventory/adjustments', { batchId: bCream.id, warehouseId: main.id, direction: 'OUT', quantity: '1', reason: 'DAMAGE', notes: 'Tube seal broken on receipt' });
  if (bPan?.id) await call('/inventory/adjustments', { batchId: bPan.id, warehouseId: main.id, direction: 'OUT', quantity: '2', reason: 'BREAKAGE' });
  if (bPan?.id) {
    const t = await call('/inventory/transfers', { sourceWarehouseId: main.id, destinationWarehouseId: cold.id, lines: [{ productId: p.pan, batchId: bPan.id, quantity: '10' }] });
    if (t?.id) await call(`/inventory/transfers/${t.id}/receive`, { lines: [{ transferLineId: t.lines[0].id, receivedQty: '10' }] });
    await call('/inventory/transfers', { sourceWarehouseId: main.id, destinationWarehouseId: cold.id, lines: [{ productId: p.pan, batchId: bPan.id, quantity: '5' }] });
  }
  if (bCream?.id) {
    const count = await call('/inventory/counts', { warehouseId: main.id, lines: [{ productId: p.cream, batchId: bCream.id, countedQty: '6' }] });
    if (count?.id) await call(`/inventory/counts/${count.id}/post`, {});
  }
  if (bAzi1?.id) await call('/inventory/recalls', { batchId: bAzi1.id, reason: 'Manufacturer recall notice CIPLA-RC-2026-118' });
  if (bExpired?.id) await call(`/inventory/batches/${bExpired.id}/status`, { status: 'QUARANTINED', reason: 'Near expiry — moved to returns shelf' }, 'PUT');

  await call('/notifications/generate', {});
  console.log(`\nDemo organisation ready.\n  Login: ${EMAIL}\n  Password: ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
