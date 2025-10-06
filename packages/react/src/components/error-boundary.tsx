import React from "react"

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): {
    hasError: boolean
    error: Error
  } {
    return { hasError: true, error }
  }

  override render(): any {
    if (this.state.hasError && this.state.error) {
      return (
        <box style={{ flexDirection: "column", padding: 2 }}>
          <text fg="red">{this.state.error.stack || this.state.error.message}</text>
        </box>
      )
    }

    return this.props.children
  }
}
