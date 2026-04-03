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

  private sanitizeErrorText(text: string): string {
    return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").replace(/\s+/g, " ").trim()
  }

  override render(): any {
    if (this.state.hasError && this.state.error) {
      const isDev = process.env.DEV === "true"
      const details = this.sanitizeErrorText(
        this.state.error.stack || this.state.error.message || "An unexpected error occurred."
      )

      return (
        <box style={{ flexDirection: "column", padding: 2 }}>
          <text fg="red">{isDev ? details : "An unexpected error occurred."}</text>
        </box>
      )
    }

    return this.props.children
  }
}
