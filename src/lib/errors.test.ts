import { expect, it } from 'vitest';
import { humanError } from './errors';
it.each([
  [{ status: 503 }, 'שירות הנתונים אינו זמין'],
  [{ status: 429, code: 'over_request_rate_limit' }, 'יותר מדי בקשות'],
  [{ code: 'over_email_send_rate_limit' }, 'מגבלת השליחה'],
  [{ status: 401 }, 'תוקף הכניסה הסתיים'],
  [{ status: 403 }, 'אינו מורשה'],
  [{ message: 'Invalid login credentials', status: 400 }, 'אינן נכונות'],
  [new Error('Failed to fetch'), 'לא ניתן להתחבר'],
  [{ message: 'restore_snapshot_changed' }, 'להוריד עותק חדש'],
  [new Error('יש לבחור קטגוריה.'), 'יש לבחור קטגוריה.'],
])('provides actionable Hebrew for backend failures without leaking raw details', (error, copy) => {
  expect(humanError(error)).toContain(copy);
  expect(humanError(error)).not.toContain('₪0');
});
