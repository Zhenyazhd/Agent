import React from 'react';
import '../styles/ErrorBoundary.css';
import { env } from '../env';

type Props = {
  children: React.ReactNode;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (env.DEV) {
      console.error('[UI ErrorBoundary]', error, errorInfo);
    }

    this.setState({ errorInfo });
  }

  private reset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    this.props.onReset?.();
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const stack = this.state.error?.stack;
    const componentStack = this.state.errorInfo?.componentStack;

    return (
      <div className="error-boundary">
        <h2 className="error-boundary__title">Something went wrong</h2>
        <p className="error-boundary__text">
          Try refreshing the page. If it keeps happening, check the logs.
        </p>

        <div className="error-boundary__actions">
          <button type="button" onClick={this.reset}>
            Try again
          </button>
          <button type="button" onClick={this.reload}>
            Refresh
          </button>
        </div>

        {env.DEV && (stack || componentStack) && (
          <pre className="error-boundary__details">
            {stack ?? 'No error stack.'}
            {componentStack ? `\n\nComponent stack:\n${componentStack}` : ''}
          </pre>
        )}
      </div>
    );
  }
}