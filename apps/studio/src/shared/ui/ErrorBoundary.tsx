import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "@drift/ui";
import { log } from "@/shared/lib/log";

/** One per view: a broken view shows its error; the shell and other views keep working. */
export class ErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    log("error", `view ${this.props.name} crashed`, { error: error.message, stack: info.componentStack?.slice(0, 2000) });
  }

  override render() {
    if (this.state.error)
      return (
        <ErrorState title={`The ${this.props.name} view failed`} error={this.state.error} onRetry={() => this.setState({ error: null })}>
          The rest of the app still works. Details are in Logs.
        </ErrorState>
      );
    return this.props.children;
  }
}
