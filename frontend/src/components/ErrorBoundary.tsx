import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div>
          {this.props.fallback}
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button className="btn-confirm" onClick={this.handleRetry}>重試</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppCrashPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', padding: '32px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>系統發生錯誤</h1>
      <p style={{ color: 'var(--c-text-dim)', marginBottom: '8px' }}>很抱歉，應用程式遇到未預期的錯誤。</p>
      <p style={{ color: 'var(--c-text-dim)' }}>請點擊下方按鈕嘗試重新載入。</p>
    </div>
  );
}

export function SectionError({ name }: { name: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px', margin: '16px' }}>
      <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>{name}區塊發生錯誤</div>
      <p style={{ color: 'var(--c-text-dim)', fontSize: '13px' }}>此區塊已隔離，不影響其他功能。</p>
    </div>
  );
}
