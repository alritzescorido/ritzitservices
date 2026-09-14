import { totpCode } from '../admin/totp.js';

// Prints the current 6-digit authenticator code for a base32 secret, for staff
// who have no authenticator app yet (or for testing). Codes change every 30 s.
//
//   npm run admin:totp -- --secret JBSWY3DPEHPK3PXP
const args = process.argv.slice(2);
const i = args.indexOf('--secret');
const secret = i >= 0 ? args[i + 1] : undefined;
if (!secret || !/^[A-Z2-7]{16,64}$/i.test(secret)) {
  process.stderr.write('usage: --secret <base32 secret shown at first sign-in>\n');
  process.exit(2);
}
const now = Date.now();
const left = 30 - Math.floor((now / 1000) % 30);
process.stdout.write(`${totpCode(secret, now)}  (valid ${left} more seconds; next: ${totpCode(secret, now + 30_000)})\n`);
