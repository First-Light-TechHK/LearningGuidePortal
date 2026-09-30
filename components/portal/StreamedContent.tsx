import { Fragment, type ReactNode } from "react";

// Next 15's bundled React can replay a suspended host with its hydration cursor
// inside that host (react/react#35494). A keyed Fragment owns reconciliation of
// streamed children without adding HTML. An unkeyed Fragment is flattened and
// does not protect the host. Remove only after the bundled renderer is fixed.
export function StreamedContent({ children }: { children: ReactNode }) {
  return <Fragment key="streamed-content">{children}</Fragment>;
}
