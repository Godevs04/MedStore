import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import Razorpay from 'razorpay';
import { priceFor, type BillingInterval, type PaidPlanKey } from '@medicore/shared-types';
import { loadEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException, NotFound } from '../common/app-exception.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';

interface GatewayError {
  statusCode?: number;
  error?: { description?: string };
  message?: string;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // clamp 31 Jan + 1 month to month end
  return d;
}

/**
 * Plan payments through Razorpay Standard Checkout. The server decides the
 * amount, binds the order to one workspace and plan in the order notes, and
 * only activates a plan after the HMAC signature and the payment itself check out.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private gateway(): { client: Razorpay; keyId: string; keySecret: string } {
    const env = loadEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new AppException('SERVICE_UNAVAILABLE', 'Online payment is not configured. Contact MediCore support.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      client: new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }),
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
    };
  }

  /** Maps gateway failures to our envelope. A 401 from Razorpay is a server config problem, not the user's session. */
  private gatewayFailure(action: string, error: unknown): AppException {
    const e = error as GatewayError;
    const detail = e.error?.description ?? e.message ?? 'unknown error';
    this.logger.error(`Razorpay ${action} failed (${e.statusCode ?? 'no status'}): ${detail}`);
    if (e.statusCode === 401) {
      return new AppException('SERVICE_UNAVAILABLE', 'The payment gateway rejected our credentials. Contact MediCore support.', HttpStatus.BAD_GATEWAY);
    }
    return new AppException('INTERNAL_ERROR', 'The payment gateway could not process this request. Please try again.', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async createOrder(request: TenantRequest, dto: { planKey: PaidPlanKey; interval: BillingInterval }) {
    const { client, keyId } = this.gateway();
    const organizationId = request.tenantContext.organizationId;
    const plan = await this.prisma.subscriptionPlan.findFirst({ where: { key: dto.planKey, isActive: true } });
    if (!plan) throw NotFound('Plan not found');

    const price = priceFor(dto.planKey, dto.interval);
    if (price.totalPaise < 100) {
      throw new AppException('VALIDATION_ERROR', 'Amount is below the gateway minimum of 100 paise', HttpStatus.BAD_REQUEST);
    }

    try {
      const order = await client.orders.create({
        amount: price.totalPaise,
        currency: 'INR',
        receipt: `sub_${organizationId.slice(0, 8)}_${Date.now().toString(36)}`,
        notes: { organizationId, planKey: dto.planKey, interval: dto.interval, userId: request.principal.userId },
      });
      return {
        orderId: order.id,
        amount: price.totalPaise,
        currency: 'INR' as const,
        keyId,
        planKey: dto.planKey,
        planName: plan.name,
        interval: dto.interval,
        breakdown: { basePaise: price.basePaise, gstPaise: price.gstPaise, totalPaise: price.totalPaise },
        prefill: { name: request.principal.fullName, email: request.principal.email },
      };
    } catch (error) {
      throw this.gatewayFailure('order creation', error);
    }
  }

  async verifyPayment(request: TenantRequest, dto: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const { client, keySecret } = this.gateway();
    const organizationId = request.tenantContext.organizationId;

    // 1. Signature: HMAC-SHA256(order_id|payment_id, key_secret), compared in constant time.
    const expected = createHmac('sha256', keySecret).update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(dto.razorpay_signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn(`Signature mismatch for order ${dto.razorpay_order_id} (org ${organizationId})`);
      throw new AppException('VALIDATION_ERROR', 'Payment signature could not be verified. No plan change was made.', HttpStatus.BAD_REQUEST);
    }

    // 2. The order must belong to this workspace, and the payment must match it and be captured.
    let order: { id: string; amount: number | string; notes?: Record<string, unknown> | unknown[] };
    let payment: { id: string; order_id: string; amount: number | string; status: string };
    try {
      order = (await client.orders.fetch(dto.razorpay_order_id)) as typeof order;
      payment = (await client.payments.fetch(dto.razorpay_payment_id)) as typeof payment;
      if (payment.status === 'authorized') {
        payment = (await client.payments.capture(dto.razorpay_payment_id, Number(payment.amount), 'INR')) as typeof payment;
      }
    } catch (error) {
      throw this.gatewayFailure('payment lookup', error);
    }
    const notes = (Array.isArray(order.notes) ? {} : (order.notes ?? {})) as Record<string, string>;
    if (notes.organizationId !== organizationId) {
      throw new AppException('FORBIDDEN', 'This payment belongs to a different workspace.', HttpStatus.FORBIDDEN);
    }
    if (payment.order_id !== order.id || Number(payment.amount) !== Number(order.amount)) {
      throw new AppException('VALIDATION_ERROR', 'Payment does not match the order. No plan change was made.', HttpStatus.BAD_REQUEST);
    }
    if (payment.status !== 'captured') {
      throw new AppException('STATE_TRANSITION_INVALID', `Payment is ${payment.status}, not captured. No plan change was made.`, HttpStatus.CONFLICT);
    }
    const planKey = notes.planKey as PaidPlanKey;
    const interval = notes.interval as BillingInterval;
    const expectedTotal = priceFor(planKey, interval).totalPaise;
    if (Number(order.amount) !== expectedTotal) {
      throw new AppException('VALIDATION_ERROR', 'Paid amount does not match the plan price. Contact support.', HttpStatus.BAD_REQUEST);
    }

    // 3. Activate once per payment id (advisory lock + event marker make retries and double-clicks safe).
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { key: planKey } });
    if (!plan) throw NotFound('Plan not found');
    const marker = `razorpay:${dto.razorpay_payment_id}`;
    const months = interval === 'ANNUAL' ? 12 : 1;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${marker}))`;
      const current = await tx.subscription.findUnique({ where: { organizationId } });
      if (current) {
        const done = await tx.subscriptionEvent.findFirst({ where: { subscriptionId: current.id, notes: { startsWith: marker } } });
        if (done) return { sub: current, alreadyApplied: true };
      }
      const now = new Date();
      // Same plan, still active: extend from the current end. Otherwise start now (no proration).
      const extend = current && current.planId === plan.id && current.status === 'ACTIVE' && current.currentPeriodEnd > now;
      const periodStart = extend ? current.currentPeriodStart : now;
      const periodEnd = addMonths(extend ? current.currentPeriodEnd : now, months);
      const fields = { planId: plan.id, status: 'ACTIVE' as const, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, trialEndsAt: null, graceEndsAt: null, cancelledAt: null };
      const sub = current
        ? await tx.subscription.update({ where: { organizationId }, data: fields })
        : await tx.subscription.create({ data: { organizationId, ...fields } });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: current && current.planId !== plan.id ? 'PLAN_CHANGED' : 'PERIOD_UPDATED',
          fromPlanId: current?.planId ?? null,
          toPlanId: plan.id,
          actorUserId: request.principal.userId,
          notes: `${marker} · ${interval.toLowerCase()} · order ${dto.razorpay_order_id} · ₹${(Number(order.amount) / 100).toFixed(2)} incl. GST`,
        },
      });
      return { sub, alreadyApplied: false };
    });

    if (!result.alreadyApplied) {
      await this.audit.record({
        event: 'SETTINGS_UPDATED',
        organizationId,
        actorUserId: request.principal.userId,
        entityType: 'Subscription',
        entityId: result.sub.id,
        details: { event: 'SUBSCRIPTION_PAID', planKey, interval, paymentId: dto.razorpay_payment_id, orderId: dto.razorpay_order_id, amountPaise: Number(order.amount) },
      });
    }
    return { paid: true, planKey, status: result.sub.status, currentPeriodEnd: result.sub.currentPeriodEnd };
  }
}
