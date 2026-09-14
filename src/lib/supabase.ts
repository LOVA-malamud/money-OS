import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
function isPrivileged(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  try { return JSON.parse(atob(value.split('.')[1])).role === 'service_role'; } catch { return false; }
}
export const configurationError = !url || !key ? 'missing' : isPrivileged(key) ? 'privileged-key' : !/^https:\/\//.test(url) && !(import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) ? 'invalid-url' : null;
export const isLocalTest = import.meta.env.DEV && import.meta.env.VITE_LOCAL_TEST === 'true';
export const supabase = configurationError ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
export const storageNamespace = `lova:${url}`;

export function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (/[\u0590-\u05ff]/.test(message)) return message;
  const lower = message.toLowerCase();
  if (/email.*rate.*limit|over_email_send_rate_limit/.test(lower)) return 'שירות הדוא״ל הגיע למגבלת השליחה. הבקשה הזו לא שלחה מייל חדש. יש להמתין לפני ניסיון נוסף; אפשר לבדוק את המייל האחרון שכבר התקבל.';
  if (/rate.*limit|over_request_rate_limit/.test(lower)) return 'בוצעו יותר מדי בקשות בזמן קצר. יש להמתין לפני ניסיון נוסף.';
  if (/invalid login|invalid credentials/.test(lower)) return 'כתובת הדוא״ל או הסיסמה אינן נכונות.';
  if (/restore_snapshot_changed/.test(lower)) return 'הנתונים השתנו מאז הורדת עותק הבטיחות. יש להוריד עותק חדש ולאשר שוב לפני השחזור.';
  if (/revision|conflict|stale/.test(lower)) return 'הפריט השתנה במכשיר אחר. יש לרענן ולבדוק את הגרסה העדכנית.';
  if (/generation|dataset_changed/.test(lower)) return 'הנתונים שוחזרו מאז פתיחת המסך. יש לרענן לפני המשך העבודה.';
  if (/owner|not allowed|permission|unauthorized|forbidden|allowlist/.test(lower)) return 'החשבון הזה אינו מורשה לגשת לנתונים. יש לבדוק את הגדרת חשבון הבעלים.';
  if (/fetch|network|connection|timeout/.test(lower)) return 'לא ניתן להתחבר כרגע. בדקו את החיבור ונסו שוב; שמירה שלא אושרה תישאר לבדיקה.';
  if (/refund/.test(lower)) return 'ההחזר חייב להיות מקושר להוצאה פעילה ובסכום שאינו עולה על היתרה להחזר.';
  if (/opening/.test(lower)) return 'יש לבדוק את יתרת הפתיחה. לא ניתן לבטל אותה כל עוד קיימות תנועות תלויות.';
  if (/allocation|obligation|remaining/.test(lower)) return 'יש לבדוק את סכום התשלום, היתרה לתשלום והקישור להתחייבות.';
  if (/duplicate|idempot|operation/.test(lower)) return 'יש להשלים את בדיקת השמירה הקודמת לפני שינוי הפעולה.';
  return 'לא ניתן לאשר את הפעולה. בדקו את השדות ואת החיבור; אם מופיעה שמירה שממתינה לבדיקה, יש לבדוק אותה לפני ניסיון חדש.';
}
