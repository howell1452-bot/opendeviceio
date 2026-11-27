import Link from "next/link";
import { pageWindow, showingLabel } from "@/lib/paging";

/**
 * Numbered pager for a server-paged listing: ← Previous, first/last and the
 * current page ± 2 (with gaps), Next →, and "Showing 101–200 of 2,591".
 * `href(page)` builds each link, keeping the listing's filters.
 */
export function Pager({
  page,
  pages,
  total,
  pageSize,
  href,
  label = "Pages"
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  href: (page: number) => string;
  label?: string;
}) {
  const link = "rounded-md px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50 hover:text-brand-900";
  const muted = "rounded-md px-3 py-1.5 text-slate-400";
  return (
    <nav aria-label={label} className="mt-8 flex flex-col items-center gap-3 text-sm sm:flex-row sm:justify-between">
      <p className="text-slate-600" data-testid="pager-showing">
        {showingLabel(page, pageSize, total)}
      </p>
      {pages > 1 ? (
        <ul className="flex flex-wrap items-center justify-center gap-1">
          <li>
            {page > 1 ? (
              <Link className={link} href={href(page - 1)} rel="prev">
                ← Previous
              </Link>
            ) : (
              <span className={muted} aria-disabled="true">
                ← Previous
              </span>
            )}
          </li>
          {pageWindow(page, pages).map((slot, i) =>
            slot === "gap" ? (
              <li key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={slot}>
                {slot === page ? (
                  <span
                    aria-current="page"
                    className="rounded-md bg-brand-700 px-3 py-1.5 font-semibold text-white"
                  >
                    {slot}
                  </span>
                ) : (
                  <Link className={link} href={href(slot)} aria-label={`Page ${slot}`}>
                    {slot}
                  </Link>
                )}
              </li>
            )
          )}
          <li>
            {page < pages ? (
              <Link className={link} href={href(page + 1)} rel="next">
                Next →
              </Link>
            ) : (
              <span className={muted} aria-disabled="true">
                Next →
              </span>
            )}
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
