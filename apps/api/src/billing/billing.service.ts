import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import Razorpay from 'razorpay';
import { BILLING_INTERVALS, isPaidPlanKey, priceFor, type BillingInterval, type PaidPlanKey } from '@medicore/shared-types';
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

  /** 'test' for rzp_test_ keys, 'live' for rzp_live_ keys, null when payment is not configured. */
  static mode(): 'test' | 'live' | null {
    const keyId = loadEnv().RAZORPAY_KEY_ID;
    if (!keyId || !loadEnv().RAZORPAY_KEY_SECRET) return null;
    return keyId.startsWith('rzp_live_') ? 'live' : 'test';
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
        mode: BillingService.mode(),
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
      order = (await client.orders.fetch(dto.razorpay_order_id));
      payment = (await client.payments.fetch(dto.razorpay_payment_id));
      if (payment.status === 'authorized') {
        payment = (await client.payments.capture(dto.razorpay_payment_id, Number(payment.amount), 'INR'));
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
    const applied = await this.applyPayment({ order, paymentId: dto.razorpay_payment_id, actorUserId: request.principal.userId });
    if (!applied) throw new AppException('VALIDATION_ERROR', 'This order is not a plan payment. No plan change was made.', HttpStatus.BAD_REQUEST);
    return { paid: true, planKey: applied.planKey, status: applied.status, currentPeriodEnd: applied.currentPeriodEnd };
  }

  /**
   * Handles a Razorpay webhook. The raw body is authenticated with the webhook secret,
   * then the captured payment is applied through the same idempotent path as the browser
   * confirmation, so a payment is never applied twice, and a payment whose browser tab was
   * closed still activates the plan.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true; applied?: boolean; ignored?: string }> {
    const env = loadEnv();
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new AppException('SERVICE_UNAVAILABLE', 'Webhook is not configured.', HttpStatus.SERVICE_UNAVAILABLE);
    if (!rawBody || !signature) throw new AppException('VALIDATION_ERROR', 'Missing webhook signature.', HttpStatus.BAD_REQUEST);
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Webhook rejected: bad signature');
      throw new AppException('VALIDATION_ERROR', 'Invalid webhook signature.', HttpStatus.BAD_REQUEST);
    }

    let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string; amount?: number } } } };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw new AppException('VALIDATION_ERROR', 'Webhook body is not valid JSON.', HttpStatus.BAD_REQUEST);
    }
    if (event.event === 'payment.failed') {
      this.logger.warn(`Razorpay reported payment.failed for order ${event.payload?.payment?.entity?.order_id ?? 'unknown'}`);
      return { received: true, ignored: event.event };
    }
    if (event.event !== 'payment.captured' && event.event !== 'order.paid') return { received: true, ignored: event.event ?? 'unknown' };

    const entity = event.payload?.payment?.entity;
    if (!entity?.id || !entity.order_id || entity.status !== 'captured') return { received: true, ignored: 'not a captured payment' };

    const { client } = this.gateway();
    let order: { id: string; amount: number | string; notes?: Record<string, unknown> | unknown[] };
    try {
      order = (await client.orders.fetch(entity.order_id));
    } catch (error) {
      throw this.gatewayFailure('webhook order lookup', error); // 500 makes Razorpay retry
    }
    if (Number(order.amount) !== Number(entity.amount)) return { received: true, ignored: 'amount mismatch' };
    const applied = await this.applyPayment({ order, paymentId: entity.id, actorUserId: null });
    return applied ? { received: true, applied: !applied.alreadyApplied } : { received: true, ignored: 'not a plan payment' };
  }

  /**
   * Activates or extends the plan for a captured payment, exactly once per payment id.
   * Returns null when the order is not one of ours (no workspace or plan in its notes).
   */
  private async applyPayment(args: {
    order: { id: string; amount: number | string; notes?: Record<string, unknown> | unknown[] };
    paymentId: string;
    actorUserId: string | null;
  }) {
    const { order, paymentId, actorUserId } = args;
    const notes = (Array.isArray(order.notes) ? {} : (order.notes ?? {})) as Record<string, string>;
    const organizationId = notes.organizationId;
    const planKey = notes.planKey as PaidPlanKey;
    const interval = notes.interval as BillingInterval;
    if (!organizationId || !isPaidPlanKey(planKey) || !(BILLING_INTERVALS as readonly string[]).includes(interval)) return null;
    if (Number(order.amount) !== priceFor(planKey, interval).totalPaise) {
      throw new AppException('VALIDATION_ERROR', 'Paid amount does not match the plan price. Contact support.', HttpStatus.BAD_REQUEST);
    }
    const [org, plan] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
      this.prisma.subscriptionPlan.findUnique({ where: { key: planKey } }),
    ]);
    if (!org || !plan) return null;

    const marker = `razorpay:${paymentId}`;
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
          actorUserId,
          notes: `${marker} · ${interval.toLowerCase()} · order ${order.id} · ₹${(Number(order.amount) / 100).toFixed(2)} incl. GST`,
        },
      });
      return { sub, alreadyApplied: false };
    });

    if (!result.alreadyApplied) {
      await this.audit.record({
        event: 'SETTINGS_UPDATED',
        organizationId,
        actorUserId,
        entityType: 'Subscription',
        entityId: result.sub.id,
        details: { event: 'SUBSCRIPTION_PAID', planKey, interval, paymentId, orderId: order.id, amountPaise: Number(order.amount) },
      });
    }
    return { planKey, status: result.sub.status, currentPeriodEnd: result.sub.currentPeriodEnd, alreadyApplied: result.alreadyApplied };
  }
}
