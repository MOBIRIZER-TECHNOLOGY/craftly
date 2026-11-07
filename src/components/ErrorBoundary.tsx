import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/ui";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
  /** reset when this key changes (e.g. the route), so navigating away clears the error */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a rendering error shows a calm recovery screen instead of a
 * blank page. Designs are autosaved, so reloading never loses more than a moment of work.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Craftly crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cf-crash" role="alert">
        <div className="cf-crash__card">
          <h1>Something went wrong</h1>
          <p>Craftly hit an unexpected problem. Your designs are saved on this device, so nothing you finished is lost.</p>
          <pre className="cf-crash__detail">{this.state.error.message}</pre>
          <div className="cf-crash__actions">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload Craftly
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.hash = "#/";
                this.setState({ error: null });
              }}
            >
              Go to your projects
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
