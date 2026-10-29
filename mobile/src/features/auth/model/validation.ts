/**
 * Form schemas — replaces `form_builder_validators` usage across the auth
 * screens. Error messages are copied verbatim from the Dart `errorText`
 * arguments so the UI reads identically.
 *
 * Where the Dart validators were incomplete, the gap is noted and closed —
 * each one is called out so the change is reviewable.
 */
import { z } from 'zod';

/** Shared password complexity — register step 1 enforced all five rules. */
const passwordComplexity = z
  .string()
  .min(1, 'Password is required')
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/\d/, 'Must contain at least one number')
  .regex(
    /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;`~/]/,
    'Must contain at least one special character',
  );

/**
 * FIXED — the Dart login and register email fields omitted `required()`, so an
 * empty email passed validation and failed server-side instead. `.min(1)`
 * closes that.
 */
const email = z
  .string()
  .min(1, 'Email is required')
  .email('Enter a valid email address');

// -------------------------------------------------------------------- login
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});
export type LoginForm = z.infer<typeof loginSchema>;

// ------------------------------------------------------- register (step 1)
export const registerCredentialsSchema = z
  .object({
    email,
    password: passwordComplexity,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
export type RegisterCredentialsForm = z.infer<typeof registerCredentialsSchema>;

// ------------------------------------------------------- register (step 2)
export const otpSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .length(6, 'Code must be 6 digits')
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export type OtpForm = z.infer<typeof otpSchema>;

// ------------------------------------------------------- register (step 3)
export const personalInfoSchema = z.object({
  fullName: z.string().min(1, 'Fullname is required'),
  phone: z
    .string()
    .min(1, 'Phone number is required')
    .regex(/^\d+$/, 'Phone number must be numeric')
    .min(11, 'Phone number must be 11 digits'),
  nin: z
    .string()
    .min(1, 'NIN is required')
    // The Dart field capped input at 11 digits but only validated `required`.
    // The length rule is added here to match the NIN format the backend expects.
    .length(11, 'NIN must be 11 digits')
    .regex(/^\d{11}$/, 'NIN must be 11 digits'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  /**
   * State and LGA were not form-validated in Dart — `completeUser` toasted
   * 'Please select state and lga' instead. They are required fields here so
   * the error appears inline on the offending control.
   */
  state: z.string().min(1, 'Please select a state'),
  lga: z.string().min(1, 'Please select a local government area'),
});
export type PersonalInfoForm = z.infer<typeof personalInfoSchema>;

// ---------------------------------------------------------- forgot password
export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

/**
 * Reset password.
 *
 * FIXED — the Dart screen enforced only `minLength(8)` here while registration
 * enforced five complexity rules, letting a user reset to a weaker password
 * than they could register with. The same complexity now applies to both, and
 * the match check moved from the controller into the schema so it surfaces on
 * the field instead of as a toast.
 */
export const resetPasswordSchema = z
  .object({
    password: passwordComplexity,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

// --------------------------------------------------------------- NIN update
export const ninUpdateSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  nin: z
    .string()
    .min(1, 'NIN is required')
    .regex(/^\d+$/, 'Enter a valid NIN')
    .length(11, 'NIN must be 11 digits'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
});
export type NinUpdateForm = z.infer<typeof ninUpdateSchema>;

// -------------------------------------------------------------- edit profile
export const editProfileSchema = z.object({
  fullName: z
    .string()
    .min(1, 'Name is required')
    .min(2, 'Name must be at least 2 characters'),
  phone: z
    .string()
    .min(1, 'Phone number is required')
    .regex(/^\d+$/, 'Phone number must be numeric')
    .min(11, 'Phone number must be 11 digits'),
  state: z.string().min(1, 'Please select a state'),
  lga: z.string().min(1, 'Please select a local government area'),
});
export type EditProfileForm = z.infer<typeof editProfileSchema>;

// -------------------------------------------------------------- bank account
export const bankAccountSchema = z.object({
  bankName: z
    .string()
    .min(1, 'Bank name is required')
    .min(2, 'Bank name must be at least 2 characters')
    .max(120, 'Bank name must be at most 120 characters'),
  accountNumber: z
    .string()
    .min(1, 'Account number is required')
    .length(10, 'Account number must be exactly 10 digits')
    .regex(/^\d{10}$/, 'Account number must contain only numbers'),
  accountName: z
    .string()
    .min(1, 'Account name is required')
    .min(2, 'Account name must be at least 2 characters')
    .max(120, 'Account name must be at most 120 characters'),
});
export type BankAccountForm = z.infer<typeof bankAccountSchema>;

// ---------------------------------------------------------- settlement request
export const settlementSchema = z.object({
  amount: z
    .string()
    .min(1, 'Amount is required')
    .refine((v) => Number.isFinite(Number(v)), 'Enter a valid amount')
    .refine((v) => Number(v) >= 1, 'Minimum withdrawal is ₦1'),
});
export type SettlementForm = z.infer<typeof settlementSchema>;
