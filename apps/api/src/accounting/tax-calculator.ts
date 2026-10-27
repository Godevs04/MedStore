import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { divideHalfUp, parseMinorUnits, formatMinorUnits } from '@medicore/shared-types';
import { AppException } from '../common/app-exception.js';
import { scaled } from '../common/money.js';

export interface TaxComputation {
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  totalTax: string;
  lineTotal: string;
  /** GST rate applied (CGST+SGST or IGST), excluding cess. */
  ratePercent: string;
}

export interface ResolvedRate {
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  versionId: string;
}

const ZERO = { cgst: '0.00', sgst: '0.00', igst: '0.00', cess: '0.00', totalTax: '0.00' };

/**
 * Centralized, testable GST computation (spec §13).
 *
 * Assumption (documented in docs/compliance/gst-requirements.md): Indian
 * retail prices are tax-INCLUSIVE — the charged price (unit price / MRP)
 * includes GST. taxable = gross × 100 ÷ (100 + rate + cess), tax = gross − taxable.
 * Intra-state: CGST + SGST at half rate each; inter-state: IGST at full rate.
 * Rates are percentages with ≤2 decimals and are handled as integer basis points.
 */
@Injectable()
export class TaxCalculator {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the effective rate version for a product at a point in time:
   * the product's pinned version when active, otherwise the latest version
   * for its HSN code. Returns null when nothing is configured.
   */
  async resolveRate(
    organizationId: string,
    product: { hsnCode: string | null; taxRateVersionId: string | null },
    at: Date,
  ): Promise<ResolvedRate | null> {
    const active = { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] };
    let v = product.taxRateVersionId
      ? await this.prisma.taxRateVersion.findFirst({ where: { id: product.taxRateVersionId, organizationId, ...active } })
      : null;
    if (!v && product.hsnCode) {
      v = await this.prisma.taxRateVersion.findFirst({
        where: { organizationId, hsnCode: product.hsnCode, ...active },
        orderBy: { effectiveFrom: 'desc' },
      });
    }
    if (!v) return null;
    return {
      cgst: (v.cgstPercent ?? 0).toString(),
      sgst: (v.sgstPercent ?? 0).toString(),
      igst: (v.igstPercent ?? 0).toString(),
      cess: (v.cessPercent ?? 0).toString(),
      versionId: v.id,
    };
  }

  /**
   * Posting paths must never silently tax at 0%: a product without an
   * applicable rate version is rejected. Nil-rated goods are configured as
   * an explicit 0% version.
   */
  async requireRate(
    organizationId: string,
    product: { name: string; hsnCode: string | null; taxRateVersionId: string | null },
    at: Date,
  ): Promise<ResolvedRate> {
    const rate = await this.resolveRate(organizationId, product, at);
    if (!rate) {
      throw new AppException(
        'TAX_RATE_MISSING',
        `No GST rate configured for ${product.name}${product.hsnCode ? ` (HSN ${product.hsnCode})` : ' (no HSN code)'}. Add a tax rate version under Configuration.`,
        422,
      );
    }
    return rate;
  }

  private bps(rate: ResolvedRate | null, interState: boolean): { gst: bigint; cess: bigint } {
    if (!rate) return { gst: 0n, cess: 0n };
    const gst = interState ? scaled(rate.igst, 2) : scaled(rate.cgst, 2) + scaled(rate.sgst, 2);
    return { gst, cess: scaled(rate.cess, 2) };
  }

  private split(tax: bigint, interState: boolean) {
    if (interState) return { cgst: 0n, sgst: 0n, igst: tax };
    const cgst = divideHalfUp(tax, 2n);
    return { cgst, sgst: tax - cgst, igst: 0n };
  }

  /** Tax breakdown for a tax-INCLUSIVE gross amount; integer paise, HALF_UP. */
  computeInclusive(grossMajor: string, rate: ResolvedRate | null, interState: boolean): TaxComputation {
    const gross = parseMinorUnits(grossMajor);
    const { gst, cess } = this.bps(rate, interState);
    const ratePercent = formatMinorUnits(gst);
    if (gst + cess === 0n) {
      return { taxableValue: formatMinorUnits(gross), ...ZERO, lineTotal: formatMinorUnits(gross), ratePercent };
    }
    const taxable = divideHalfUp(gross * 10000n, 10000n + gst + cess);
    const cessAmt = divideHalfUp(taxable * cess, 10000n);
    const gstAmt = gross - taxable - cessAmt;
    const parts = this.split(gstAmt, interState);
    return {
      taxableValue: formatMinorUnits(taxable),
      cgst: formatMinorUnits(parts.cgst),
      sgst: formatMinorUnits(parts.sgst),
      igst: formatMinorUnits(parts.igst),
      cess: formatMinorUnits(cessAmt),
      totalTax: formatMinorUnits(gstAmt + cessAmt),
      lineTotal: formatMinorUnits(gross),
      ratePercent,
    };
  }

  /** Tax for a tax-EXCLUSIVE amount (purchase invoices): tax = taxable × rate. */
  computeExclusive(taxableMajor: string, rate: ResolvedRate | null, interState: boolean): TaxComputation {
    const taxable = parseMinorUnits(taxableMajor);
    const { gst, cess } = this.bps(rate, interState);
    const ratePercent = formatMinorUnits(gst);
    if (gst + cess === 0n) {
      return { taxableValue: formatMinorUnits(taxable), ...ZERO, lineTotal: formatMinorUnits(taxable), ratePercent };
    }
    const gstAmt = divideHalfUp(taxable * gst, 10000n);
    const cessAmt = divideHalfUp(taxable * cess, 10000n);
    const parts = this.split(gstAmt, interState);
    return {
      taxableValue: formatMinorUnits(taxable),
      cgst: formatMinorUnits(parts.cgst),
      sgst: formatMinorUnits(parts.sgst),
      igst: formatMinorUnits(parts.igst),
      cess: formatMinorUnits(cessAmt),
      totalTax: formatMinorUnits(gstAmt + cessAmt),
      lineTotal: formatMinorUnits(taxable + gstAmt + cessAmt),
      ratePercent,
    };
  }
}
