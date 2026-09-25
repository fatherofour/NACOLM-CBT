import Link from 'next/link';

export function PageHead({ title, intro, crumbs, action }: { title: string; intro?: string; crumbs?: [string, string?][]; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-[13px] text-ink-muted">
          {crumbs.map(([label, href], i) => (
            <span key={label} className="flex gap-2">
              {i ? <span aria-hidden="true">/</span> : null}
              {href ? <Link href={href}>{label}</Link> : <span>{label}</span>}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="t-display m-0">{title}</h1>
          {intro ? <p className="m-0 max-w-[72ch] text-ink-muted">{intro}</p> : null}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Panel({ children, className = '', ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={`rounded-lg border border-line bg-surface-raised ${className}`}>
      {children}
    </section>
  );
}
