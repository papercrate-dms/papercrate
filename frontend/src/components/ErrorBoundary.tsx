import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__message">
            An unexpected error occurred. You can try reloading the page or
            going back.
          </p>
          {this.state.error ? (
            <pre className="error-boundary__detail">
              {this.state.error.message}
            </pre>
          ) : null}
          <div className="error-boundary__actions">
            <button type="button" onClick={this.handleReload}>
              Reload page
            </button>
            <button type="button" className="secondary" onClick={this.handleReset}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
