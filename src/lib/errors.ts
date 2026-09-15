export function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (/[\u0590-\u05ff]/.test(message)) return message;
  const details = typeof error === 'object' && error !== null ? error as { status?: unknown; code?: unknown } : {};
  const lower = `${message} ${typeof details.code === 'string' ? details.code : ''}`.toLowerCase();
  if (/email.*rate.*limit|over_email_send_rate_limit/.test(lower)) return 'שירות הדוא״ל הגיע למגבלת השליחה. הבקשה הזו לא שלחה מייל חדש. יש להמתין לפני ניסיון נוסף; אפשר לבדוק את המייל האחרון שכבר התקבל.';
  if (details.status === 429 || /rate.*limit|over_request_rate_limit/.test(lower)) return 'בוצעו יותר מדי בקשות בזמן קצר. יש להמתין לפני ניסיון נוסף.';
  if (/invalid login|invalid credentials/.test(lower)) return 'כתובת הדוא״ל או הסיסמה אינן נכונות.';
  if (details.status === 401 || /jwt.*expired|invalid.*jwt|refresh.*token|session.*expired/.test(lower)) return 'תוקף הכניסה הסתיים. יש לצאת מהחשבון ולהתחבר שוב כדי לטעון נתונים עדכניים.';
  if ([502, 503, 504].includes(Number(details.status)) || /project.*paused|service.*unavailable|bad gateway/.test(lower)) return 'שירות הנתונים אינו זמין כרגע. אין אפשרות לאמת את היתרות. יש לנסות שוב לאחר חזרת השירות.';
  if (/restore_snapshot_changed/.test(lower)) return 'הנתונים השתנו מאז הורדת עותק הבטיחות. יש להוריד עותק חדש ולאשר שוב לפני השחזור.';
  if (/revision|conflict|stale/.test(lower)) return 'הפריט השתנה במכשיר אחר. יש לרענן ולבדוק את הגרסה העדכנית.';
  if (/generation|dataset_changed/.test(lower)) return 'הנתונים שוחזרו מאז פתיחת המסך. יש לרענן לפני המשך העבודה.';
  if (details.status === 403 || /owner|not allowed|permission|unauthorized|forbidden|allowlist|42501/.test(lower)) return 'החשבון הזה אינו מורשה לגשת לנתונים. יש לבדוק את הגדרת חשבון הבעלים.';
  if (/fetch|network|connection|timeout/.test(lower)) return 'לא ניתן להתחבר כרגע. בדקו את החיבור ונסו שוב; שמירה שלא אושרה תישאר לבדיקה.';
  if (/refund/.test(lower)) return 'ההחזר חייב להיות מקושר להוצאה פעילה ובסכום שאינו עולה על היתרה להחזר.';
  if (/opening/.test(lower)) return 'יש לבדוק את יתרת הפתיחה. לא ניתן לבטל אותה כל עוד קיימות תנועות תלויות.';
  if (/allocation|obligation|remaining/.test(lower)) return 'יש לבדוק את סכום התשלום, היתרה לתשלום והקישור להתחייבות.';
  if (/duplicate|idempot|operation/.test(lower)) return 'יש להשלים את בדיקת השמירה הקודמת לפני שינוי הפעולה.';
  return 'לא ניתן לאשר את הפעולה. בדקו את השדות ואת החיבור; אם מופיעה שמירה שממתינה לבדיקה, יש לבדוק אותה לפני ניסיון חדש.';
}
