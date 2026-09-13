import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AdminAuthService } from '../admin/admin-auth.service.js';
import { AppModule } from '../app.module.js';

// Creates or resets a console admin. There is no self-registration on purpose.
//
//   npm run admin:create -- --phone +639170000001 --email a.reyes@example.ph --name "A. Reyes" --password '<12+ chars>'
//
// The authenticator is enrolled on the admin's first sign-in.
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const phone = opt('phone');
const email = opt('email');
const name = opt('name');
const password = opt('password');
if (!phone || !email || !name || !password) {
  process.stderr.write('usage: --phone +63XXXXXXXXXX --email <work email> --name "<full name>" --password <12+ characters>\n');
  process.exit(2);
}
if (password.length < 12) {
  process.stderr.write('password must be at least 12 characters\n');
  process.exit(2);
}
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.SCHEDULER_ENABLED = 'false';

const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
try {
  const out = await ctx.get(AdminAuthService).createAdmin({ phone, email, fullName: name, password });
  process.stdout.write(`admin ready, user id ${out.user_id}. Authenticator enrols on first sign-in.\n`);
} finally {
  await ctx.close();
}
