export type ImportType = 'products' | 'vendors' | 'customers';

export interface ColumnSpec {
  key: string;
  label: string;
  required?: boolean;
  hint: string;
  example: string;
}

export interface ImportSpec {
  type: ImportType;
  title: string;
  singular: string;
  icon: string;
  blurb: string;
  permission: string;
  listHref: string;
  /** Columns that identify a row in the results table. */
  identity: [string, string];
  columns: ColumnSpec[];
}

export const MAX_ROWS = 5000;

export const IMPORT_SPECS: Record<ImportType, ImportSpec> = {
  products: {
    type: 'products',
    title: 'Products',
    singular: 'Product',
    icon: '✚',
    blurb: 'Medicines and retail items with HSN, prices, schedule and barcodes.',
    permission: 'products.import',
    listHref: '/products',
    identity: ['sku', 'name'],
    columns: [
      { key: 'name', label: 'Name', required: true, hint: '2–200 characters', example: 'Paracetamol 650mg Tablet' },
      { key: 'sku', label: 'SKU', required: true, hint: 'Unique; letters, digits, dot, dash, underscore', example: 'PCM-650' },
      { key: 'genericName', label: 'Generic name', hint: 'Salt / composition', example: 'Paracetamol' },
      { key: 'brand', label: 'Brand', hint: 'Marketed brand', example: 'Calpol' },
      { key: 'strength', label: 'Strength', hint: 'e.g. 650mg, 5ml', example: '650mg' },
      { key: 'dosageForm', label: 'Dosage form', hint: 'TABLET, CAPSULE, SYRUP, INJECTION, DROPS, OINTMENT…', example: 'TABLET' },
      { key: 'packSize', label: 'Pack size', hint: 'Free text', example: '15 tablets' },
      { key: 'hsnCode', label: 'HSN code', hint: '4, 6 or 8 digits; needs a GST rate to sell', example: '30049099' },
      { key: 'mrp', label: 'MRP', hint: 'Decimal, e.g. 32.50', example: '32.50' },
      { key: 'purchasePrice', label: 'Purchase price', hint: 'Decimal', example: '22.00' },
      { key: 'sellingPrice', label: 'Selling price', hint: 'Decimal', example: '30.00' },
      { key: 'prescriptionClass', label: 'Prescription class', hint: 'OTC, PRESCRIPTION_ONLY, SCHEDULE_H1, SCHEDULE_X, NARCOTIC', example: 'OTC' },
      { key: 'reorderLevel', label: 'Reorder level', hint: 'Whole number; triggers low-stock alerts', example: '50' },
      { key: 'rackLocation', label: 'Rack location', hint: 'Shelf / bin', example: 'A-3' },
      { key: 'requiresRefrigeration', label: 'Refrigerated', hint: 'yes / no', example: 'no' },
      { key: 'barcodes', label: 'Barcodes', hint: 'Separate several with |', example: '8901234567890' },
    ],
  },
  vendors: {
    type: 'vendors',
    title: 'Vendors',
    singular: 'Vendor',
    icon: '⇄',
    blurb: 'Suppliers and distributors with GSTIN, address and credit terms.',
    permission: 'vendors.import',
    listHref: '/vendors',
    identity: ['legalName', 'gstin'],
    columns: [
      { key: 'legalName', label: 'Legal name', required: true, hint: '2–200 characters', example: 'Sunrise Pharma Distributors' },
      { key: 'tradeName', label: 'Trade name', hint: 'Name on signboard', example: 'Sunrise Pharma' },
      { key: 'gstin', label: 'GSTIN', hint: '15 characters; prefix must match state code', example: '29ABCDE1234F1Z5' },
      { key: 'gstRegistrationType', label: 'GST registration', hint: 'REGULAR, COMPOSITION, UNREGISTERED, CONSUMER', example: 'REGULAR' },
      { key: 'addressLine1', label: 'Address', hint: 'Street and area', example: '12 MG Road' },
      { key: 'city', label: 'City', hint: '', example: 'Bengaluru' },
      { key: 'stateCode', label: 'State code', hint: '2-digit GST state code', example: '29' },
      { key: 'pinCode', label: 'PIN code', hint: '6 digits', example: '560001' },
      { key: 'contactName', label: 'Contact person', hint: '', example: 'Ravi Kumar' },
      { key: 'phone', label: 'Phone', hint: 'Indian mobile number', example: '9876543210' },
      { key: 'email', label: 'Email', hint: '', example: 'orders@sunrisepharma.in' },
      { key: 'creditDays', label: 'Credit days', hint: '0–365', example: '30' },
      { key: 'creditLimit', label: 'Credit limit', hint: 'Decimal', example: '200000.00' },
      { key: 'openingBalance', label: 'Opening balance', hint: 'Positive = we owe the vendor', example: '0.00' },
    ],
  },
  customers: {
    type: 'customers',
    title: 'Customers',
    singular: 'Customer',
    icon: '☺',
    blurb: 'Retail patients, clinics and wholesale buyers with credit limits.',
    permission: 'customers.import',
    listHref: '/customers',
    identity: ['name', 'phone'],
    columns: [
      { key: 'name', label: 'Name', required: true, hint: '1–200 characters', example: 'City Care Clinic' },
      { key: 'phone', label: 'Phone', hint: 'Indian mobile number; used for duplicate checks', example: '9123456780' },
      { key: 'email', label: 'Email', hint: '', example: 'accounts@citycare.in' },
      { key: 'category', label: 'Category', hint: 'e.g. Clinic, Hospital, Retail', example: 'Clinic' },
      { key: 'gstin', label: 'GSTIN', hint: 'For B2B tax invoices', example: '' },
      { key: 'addressLine1', label: 'Address', hint: '', example: '4 Lake View Road' },
      { key: 'city', label: 'City', hint: '', example: 'Bengaluru' },
      { key: 'stateCode', label: 'State code', hint: '2-digit GST state code', example: '29' },
      { key: 'pinCode', label: 'PIN code', hint: '6 digits', example: '560034' },
      { key: 'creditDays', label: 'Credit days', hint: '0–365', example: '15' },
      { key: 'creditLimit', label: 'Credit limit', hint: 'Decimal; enforced at billing', example: '25000.00' },
      { key: 'isWholesale', label: 'Wholesale', hint: 'yes / no', example: 'yes' },
    ],
  },
};

/** CSV parser handling quoted cells, escaped quotes, CRLF and a UTF-8 BOM. */
export function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const source = text.replace(/^\uFEFF/, '');
  const table: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) table.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  if (table.length === 0) return { headers: [], rows: [] };
  const headers = table[0]!.map((h) => h.trim());
  const rows = table.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = r[i]?.trim() ?? '';
    });
    return obj;
  });
  return { headers: headers.filter(Boolean), rows };
}

const csvCell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function templateCsv(spec: ImportSpec): string {
  return toCsv(
    spec.columns.map((c) => c.key),
    [spec.columns.map((c) => c.example)],
  );
}

/** "1 vendor", "2,500 vendors" — lowercase noun with an Indian-grouped count. */
export function countOf(n: number, spec: Pick<ImportSpec, 'title' | 'singular'>): string {
  return `${n.toLocaleString('en-IN')} ${(n === 1 ? spec.singular : spec.title).toLowerCase()}`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
