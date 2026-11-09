import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordProblem, type Problem } from "@/core/problems";
import { markCrashing, noteCrash } from "@/core/recovery";
import { CrashScreen } from "./CrashScreen";

interface Props {
  children: ReactNode;
  /** reset when this key changes (e.g. the route), so navigating away clears the error */
  resetKey?: string;
  /** the design that is open, when the screen is the editor: what is counted and offered after a crash is about it */
  designId?: string | null;
}

interface State {
  error: Error | null;
  problem: Problem | null;
  crashes: number;
}

const CLEAR: State = { error: null, problem: null, crashes: 0 };

/**
 * Last line of defence: a rendering error shows a calm recovery screen instead of a blank page (src/components/CrashScreen.tsx,
 * docs/CRASH-RECOVERY.md). The error is written down on this device, and the editor is told that it is going away because the
 * screen stopped, so that it does not write over the last saved state with the one that may have caused it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = CLEAR;

  static getDerivedStateFromError(error: Error): Partial<State> {
    // before anything below is unmounted: the editor's cleanup asks (see persistOnLeave)
    markCrashing(true);
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Craftly crashed:", error, info.componentStack);
    const designId = this.props.designId;
    this.setState({ problem: recordProblem("screen", error), crashes: designId ? noteCrash(designId) : 0 });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.recover();
  }

  private recover() {
    markCrashing(false);
    this.setState(CLEAR);
  }

  render() {
    const { error, problem, crashes } = this.state;
    if (!error) return this.props.children;
    return (
      <CrashScreen
        error={error}
        problem={problem}
        designId={this.props.designId ?? null}
        crashes={crashes}
        onGoToProjects={() => {
          window.location.hash = "#/";
          this.recover();
        }}
      />
    );
  }
}
