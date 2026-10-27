import { Injectable, Logger } from '@nestjs/common';

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

/** DI token for the email port. */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
