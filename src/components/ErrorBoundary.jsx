import { Component } from 'react';

class DefaultErrorFallback extends Component {
  render() {
    const { error, onReload, onReset } = this.props;

    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e1e',
        color: '#e0e0e0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: '20px',
      }}>
        <div style={{
          maxWidth: '600px',
          padding: '32px',
          background: '#252526',
          borderRadius: '8px',
          border: '1px solid #3c3c3c',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '16px',
          }}>
            <span style={{ color: '#f85149' }}>!</span>
          </div>

          <h1 style={{
            fontSize: '24px',
            fontWeight: 600,
            marginBottom: '8px',
            color: '#ffffff',
          }}>
            应用程序出错
          </h1>

          <p style={{
            fontSize: '14px',
            color: '#858585',
            marginBottom: '24px',
          }}>
            抱歉，应用程序遇到了一个错误。请尝试刷新页面或重置应用状态。
          </p>

          {error && (
            <details style={{
              marginBottom: '24px',
              padding: '12px',
              background: '#1e1e1e',
              borderRadius: '4px',
              textAlign: 'left',
            }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '13px',
                color: '#e0e0e0',
                fontWeight: 500,
              }}>
                错误详情
              </summary>
              <pre style={{
                marginTop: '12px',
                padding: '12px',
                background: '#0a0a0a',
                borderRadius: '4px',
                fontSize: '12px',
                color: '#f48771',
                overflow: 'auto',
                maxHeight: '200px',
                fontFamily: '"SF Mono", Consolas, monospace',
              }}>
                {error.toString()}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </details>
          )}

          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
          }}>
            <button
              onClick={onReset}
              style={{
                padding: '10px 20px',
                background: '#3c3c3c',
                border: '1px solid #4c4c4c',
                borderRadius: '4px',
                color: '#cccccc',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              重置应用
            </button>
            <button
              onClick={onReload}
              style={{
                padding: '10px 20px',
                background: '#0078d4',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                fontSize: '14px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <DefaultErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReload={this.handleReload}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
