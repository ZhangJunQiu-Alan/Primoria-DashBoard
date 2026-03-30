import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', padding: '32px', fontFamily: 'monospace', color: '#5a3a2a',
          background: '#fef9f5',
        }}>
          <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>发生错误</h2>
          <pre style={{
            background: '#f4ede6', padding: '16px', borderRadius: '8px',
            fontSize: '12px', maxWidth: '700px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
          }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: '20px', padding: '8px 20px', borderRadius: '999px',
              background: '#7a9e7e', color: 'white', border: 'none', cursor: 'pointer', fontSize: '14px',
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
