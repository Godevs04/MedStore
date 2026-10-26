import { z } from 'zod';
import { emailSchema } from './common';

export const passwordSchema = z
  .string()
  .min(10, 'Minimum 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Must include lower case, upper case, and a digit',
  });

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export type LoginRequestDto = z.infer<typeof loginRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(32).max(128),
});

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const registerOrganizationRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  organizationName: z.string().trim().min(2).max(160),
});

export type RegisterOrganizationRequestDto = z.infer<typeof registerOrganizationRequestSchema>;
