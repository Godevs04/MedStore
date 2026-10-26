import { SetMetadata } from '@nestjs/common';

/** Marks an endpoint as public (no session required). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
