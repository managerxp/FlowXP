/* Creating an account on the phone, confirming the email, getting a password back, and deleting the account: the same rules and the same server routes as the website, so a person can
   start the 7-day free trial without leaving the app. The server checks everything again; these only shape what a screen sends and say what is wrong before it is sent. */

export const PRIVACY_URL = 'https://flowxp.in/privacy';
export const TERMS_URL = 'https://flowxp.in/terms';
export const DELETE_URL = 'https://flowxp.in/delete-account';

/** The kinds of business that can sign up (the server's list), in the words the website uses. */
export const BUSINESS_TYPES: readonly (readonly [string, string])[] = [
  ['RESTAURANT', 'Restaurant'], ['CAFE', 'Café'], ['CLOUD_KITCHEN', 'Cloud kitchen'], ['HOTEL', 'Hotel and restaurant'], ['RETAIL', 'Retail shop'],
  ['SUPERMARKET', 'Supermarket'], ['PHARMACY', 'Pharmacy'], ['SALON', 'Salon'], ['GYM', 'Gym'], ['GAMING_CAFE', 'Gaming lounge'],
  ['AUTO_PARTS', 'Auto spare parts'], ['WHOLESALE', 'Wholesale and distribution']
];

export type SignupForm = { name: string; email: string; phone: string; password: string; businessName: string; businessType: string; agreed: boolean };
export const emptySignup = (): SignupForm => ({ name: '', email: '', phone: '', password: '', businessName: '', businessType: '', agreed: false });

export const emailLooksRight = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
/** The common slips: gmial.com, gmail.con, hotmial.com. Returns the address with the slip mended, or null. */
export const suggestEmail = (email: string): string | null => {
  const m = email.trim().match(/^([^\s@]+)@([^\s@]+)$/);
  if (!m) return null;
  const fixes: Record<string, string> = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com' };
  const fixed = fixes[m[2].toLowerCase()];
  return fixed ? `${m[1]}@${fixed}` : null;
};
/** At least ten characters, as the website asks. */
export const passwordProblem = (password: string): string => (password.length < 10 ? 'The password needs at least 10 characters.' : '');
export const phoneProblem = (phone: string): string => (phone.trim() && !/^[+]?[\d\s-]{8,15}$/.test(phone.trim()) ? 'Check the mobile number.' : '');

/** What is wrong with the form, first thing first, or an empty string. */
export const signupProblem = (f: SignupForm): string => {
  if (!f.name.trim()) return 'Type your name.';
  if (!emailLooksRight(f.email)) return 'Type your email address.';
  const ph = phoneProblem(f.phone); if (ph) return ph;
  const pw = passwordProblem(f.password); if (pw) return pw;
  if (!f.businessName.trim()) return 'Type the name of your business.';
  if (!BUSINESS_TYPES.some(([v]) => v === f.businessType)) return 'Choose what kind of business it is.';
  if (!f.agreed) return 'Agree to the Terms and the Privacy Policy to create your account.';
  return '';
};
export const signupBody = (f: SignupForm) => ({
  name: f.name.trim(), email: f.email.trim(), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), password: f.password,
  business_name: f.businessName.trim(), business_type: f.businessType, accepted_terms: f.agreed
});

/** The 6-digit code from the email, with spaces and dashes forgiven. */
export const cleanCode = (code: string): string => code.replace(/[\s-]/g, '');
export const codeProblem = (code: string): string => (/^\d{6}$/.test(cleanCode(code)) ? '' : 'Type the 6-digit code from the email.');
export const verifyBody = (challenge: string, code: string) => ({ challenge, code: cleanCode(code) });

/** Seconds left before another code may be asked for. */
export const resendWait = (sentAt: number, now = Date.now(), gap = 30): number => Math.max(0, Math.ceil(gap - (now - sentAt) / 1000));

export const resetProblem = (email: string, code: string, password: string, again: string): string => {
  if (!emailLooksRight(email)) return 'Type the email you asked the code for.';
  const c = codeProblem(code); if (c) return c;
  const p = passwordProblem(password); if (p) return p;
  return password === again ? '' : 'The two passwords are not the same.';
};
export const resetBody = (email: string, code: string, password: string) => ({ email: email.trim(), code: cleanCode(code), password });

/** Deleting the account: the password, and the authenticator or recovery code when the account has one. */
export const deleteProblem = (password: string, needsCode: boolean, code: string): string => (!password ? 'Type your password.' : needsCode && !code.trim() ? 'Type the code from your authenticator app.' : '');
export const deleteBody = (password: string, code: string) => {
  const c = code.trim();
  return { password, ...(c ? (c.includes('-') || c.length > 6 ? { recovery_code: c } : { code: c }) : {}) };
};
