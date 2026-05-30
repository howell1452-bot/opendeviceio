import type { ReactNode } from "react";

/** A simple, non-interactive code block with monospace styling. */
export function CodeBlock({
  children,
  language
}: {
  children: ReactNode;
  language?: string;
}) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm leading-relaxed text-slate-100">
      {language ? (
        <div className="mb-2 select-none text-xs uppercase tracking-wide text-slate-400">
          {language}
        </div>
      ) : null}
      <code className="font-mono">{children}</code>
    </pre>
  );
}
