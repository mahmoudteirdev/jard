import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** A fault in one screen stays in that screen: the rail and the other screens keep working. */
export class ScreenBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="note error" role="alert" style={{ display: "block" }}>
        <p style={{ margin: 0, fontWeight: 700 }}>تعطلت هذه الشاشة.</p>
        <p className="muted" style={{ margin: "6px 0 10px" }}>
          ملفاتك ما تأثرت، وباقي الشاشات شغالة. إذا تكرر هذا، انسخ التشخيص من «حول جَرد» وأرسله لنا.
        </p>
        <p className="path label muted" dir="ltr" style={{ margin: "0 0 10px" }}>{error.message}</p>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
          حاول مرة ثانية
        </button>
      </div>
    );
  }
}
