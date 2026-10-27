import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PlatformService } from './platform.service.js';
import { PlatformController } from './platform.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
