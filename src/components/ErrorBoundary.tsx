import { Component, type ReactNode } from 'react';

/** A rendering failure must never turn into plausible but incomplete totals. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="auth-page"><div className="auth-panel"><h1>לא ניתן להציג את הנתונים כרגע</h1><p className="muted">אירעה שגיאה בתצוגה. טיוטות שנשמרו במכשיר יישארו לאחר הטעינה מחדש.</p><button className="button button-primary" onClick={() => window.location.reload()}>טעינה מחדש</button></div></main>;
    return this.props.children;
  }
}
