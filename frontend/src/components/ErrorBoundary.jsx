import { Component } from 'react'

// Last line of defense: a render crash shows a clear message instead of a blank page.
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-md p-10 text-center">
        <h1 className="font-serif text-2xl">Something went wrong</h1>
        <p className="mt-2 text-sm">The page hit an unexpected error. Your saved records are not affected. Reload to continue.</p>
        <button onClick={() => window.location.reload()} className="mt-4 rounded bg-brand px-4 py-2 text-sm font-medium text-white">
          Reload
        </button>
      </div>
    )
  }
}
