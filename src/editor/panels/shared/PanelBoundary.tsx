import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, IconRefresh, IconWarning } from "@/ui";
import { EmptyHint } from "./EmptyHint";

interface Props {
  children: ReactNode;
  /** the error is cleared when this changes (switching to another tab) */
  resetKey: string;
  /** name shown in the message, e.g. "Templates" */
  label: string;
  /** called before the panel is shown again (reload a failed chunk ...) */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a side-panel tab that fails to load (a missing chunk, a bad catalogue) or to render from taking the whole
 * editor down: the rest of the editor stays usable and the panel offers to try again.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`The ${this.props.label} panel failed:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cf-panel" role="alert">
        <EmptyHint
          icon={<IconWarning />}
          title={`The ${this.props.label} panel could not load`}
          text="Everything else in the editor still works. Check your connection, then try again."
          action={
            <Button
              variant="primary"
              icon={<IconRefresh />}
              onClick={() => {
                this.props.onRetry?.();
                this.setState({ error: null });
              }}
            >
              Try again
            </Button>
          }
        />
      </div>
    );
  }
}
