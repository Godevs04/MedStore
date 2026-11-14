import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import { createEmailSender, EMAIL_SENDER } from './email.port.js';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    // Email delivery port: console by default, real SMTP when EMAIL_TRANSPORT=smtp.
    { provide: EMAIL_SENDER, useFactory: createEmailSender },
  ],
  exports: [AuthService],
})
export class AuthModule {}
