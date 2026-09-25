const PATHS: Record<string, string> = {
  check: 'M3.5 8.5l3 3 6-7',
  cross: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  warn: 'M8 2.5l6 11H2l6-11zM8 6.5v3.5M8 12v.01',
  lock: 'M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 014 0v2',
  chevron: 'M6 4l4 4-4 4',
  retry: 'M12.5 5.5A5 5 0 103 8.5M12.5 2.5v3h-3',
  page: 'M4.5 2.5h5l2.5 2.5v8.5h-7.5zM9.5 2.5V5H12',
  plus: 'M8 3v10M3 8h10',
  upload: 'M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10',
  sessions: 'M3 4h10M3 8h10M3 12h6',
  bank: 'M3 3h10v10H3zM3 7h10',
  material: 'M4.5 2.5h5L12 5v8.5H4.5zM9.5 2.5V5H12',
  results: 'M3 13V8M8 13V4M13 13v-3',
  signout: 'M9.5 3.5h3v9h-3M6.5 5.5L4 8l2.5 2.5M4 8h6',
  back: 'M10 4L6 8l4 4',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 100-4 2 2 0 000 4z',
  users: 'M6 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.5 13.5c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4M11 4.2a2.2 2.2 0 010 4.1M12.5 9.6c1.7.4 2.9 1.8 2.9 3.4',
};

export type GlyphName = keyof typeof PATHS | 'dot' | 'info';

export function Glyph({ name, className, size = 16 }: { name: GlyphName; className?: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className={['nc-glyph', className].filter(Boolean).join(' ')} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      {name === 'dot' ? (
        <circle cx={8} cy={8} r={3.5} {...common} />
      ) : name === 'info' ? (
        <>
          <circle cx={8} cy={8} r={6} {...common} />
          <path d="M8 7.5v4M8 5v.01" {...common} />
        </>
      ) : (
        <path d={PATHS[name]} {...common} />
      )}
    </svg>
  );
}
