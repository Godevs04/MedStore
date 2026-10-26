import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import { ConsoleEmailSender, EMAIL_SENDER } from './email.port.js';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    // Email delivery port: console transport until SMTP integration is connected
    // and tested (spec §1.32 — never claim an integration works before testing).
    { provide: EMAIL_SENDER, useValue: new ConsoleEmailSender() },
  ],
  exports: [AuthService],
})
export class AuthModule {}
