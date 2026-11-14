import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '../config/env.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Body is plain text; templates live with their senders. */
  body: string;
}

/**
 * Email delivery port (spec §1.32): we never represent an unconnected
 * integration as operational. The console transport prints to the server
 * log and is explicitly NOT a claim that email was delivered.
 */
export abstract class EmailSender {
  abstract send(email: OutgoingEmail): Promise<void>;
}

@Injectable()
export class ConsoleEmailSender extends EmailSender {
  private readonly logger = new Logger('Email(console)');

  send(email: OutgoingEmail): Promise<void> {
    // Console transport: development only. Logs the intent, not a delivery.
    this.logger.log(
      `EMAIL (console transport — not delivered): to=${email.to} subject="${email.subject}"\n${email.body}`,
    );
    return Promise.resolve();
  }
}

/** Real delivery over SMTP (EMAIL_TRANSPORT=smtp). Failures are logged and rethrown so callers never claim delivery. */
@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly logger = new Logger('Email(smtp)');
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    super();
    const env = loadEnv();
    this.transporter = env.SMTP_URL
      ? nodemailer.createTransport(env.SMTP_URL)
      : nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_PORT === 465, // 587 upgrades with STARTTLS
          requireTLS: env.SMTP_PORT !== 465,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        });
    const address = env.SMTP_FROM_ADDRESS ?? env.SMTP_USER ?? 'no-reply@localhost';
    this.from = `"${env.SMTP_FROM_NAME.replace(/"/g, '')}" <${address}>`;
  }

  async send(email: OutgoingEmail): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to: email.to, subject: email.subject, text: email.body });
      this.logger.log(`Sent "${email.subject}" to ${email.to}`);
    } catch (error) {
      this.logger.error(`Failed to send "${email.subject}" to ${email.to}: ${(error as Error).message}`);
      throw error;
    }
  }
}

/** Picks the transport from EMAIL_TRANSPORT. */
export function createEmailSender(): EmailSender {
  return loadEnv().EMAIL_TRANSPORT === 'smtp' ? new SmtpEmailSender() : new ConsoleEmailSender();
}

/** DI token for the email port. */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
