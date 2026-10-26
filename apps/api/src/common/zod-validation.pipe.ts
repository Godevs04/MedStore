import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

/**
 * Server-side Zod validation pipe (spec §1.16). All external inputs are
 * validated on the server — this is the single entry point for body/query
 * validation across controllers:
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createSchema)) dto: CreateDto) { ... }
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.join('.') : undefined,
        message: issue.message,
      }));
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details,
      });
    }
    return result.data;
  }
}
