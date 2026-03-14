import React from "react";

type State = { error: Error | null; info: string | null };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a short component stack for debugging; avoid spamming logs in prod.
    this.setState({ error, info: info.componentStack || null });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || "Unexpected error";
    const showDetails = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="glass max-w-2xl w-full rounded-2xl shadow-soft overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="text-lg font-black text-gray-900">页面发生错误</div>
            <div className="mt-1 text-sm text-gray-600">{msg}</div>
          </div>

          <div className="px-6 py-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                onClick={() => window.location.reload()}
              >
                刷新页面
              </button>
              <a className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" href="/admin/login">
                返回登录
              </a>
            </div>

            {showDetails && (
              <details className="rounded-xl border border-gray-100 bg-white/70 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-gray-700">调试信息</summary>
                <pre className="mt-3 whitespace-pre-wrap text-xs text-gray-700">{this.state.error?.stack || ""}</pre>
                {this.state.info && <pre className="mt-3 whitespace-pre-wrap text-xs text-gray-700">{this.state.info}</pre>}
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }
}

