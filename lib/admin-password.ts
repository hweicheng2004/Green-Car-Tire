// Optional ADMIN_PASSWORD gate for pages that change stock or spend API credit (/setup loads, /import with Claude).
import { timingSafeEqual } from 'node:crypto';

export function passwordOk(req: Request, want = process.env.ADMIN_PASSWORD) {
  if (!want) return true;
  const got = Buffer.from(req.headers.get('x-admin-password') ?? ''), exp = Buffer.from(want);
  return got.length === exp.length && timingSafeEqual(got, exp);
}
