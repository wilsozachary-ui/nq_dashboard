import './Skeleton.css';

/**
 * Skeleton — inline shimmer block for loading placeholders.
 *
 * Props:
 *   width     string | number   CSS width or pixel number   (default '100%')
 *   height    string | number   CSS height or pixel number  (default 14)
 *   radius    string            CSS border-radius override
 *   className string            additional class names
 */
export function Skeleton({ width = '100%', height = 14, radius, className = '' }) {
  return (
    <span
      className={`sk-block${className ? ` ${className}` : ''}`}
      style={{
        width:        typeof width  === 'number' ? `${width}px`  : width,
        height:       typeof height === 'number' ? `${height}px` : height,
        borderRadius: radius ?? 'var(--radius-sm)',
      }}
      aria-hidden="true"
    />
  );
}

/**
 * SkeletonRow — one label+value pair, matching the .info-row layout.
 */
export function SkeletonRow({ labelWidth = '36%', valueWidth = '24%' }) {
  return (
    <div className="sk-row">
      <Skeleton width={labelWidth} height={12} />
      <Skeleton width={valueWidth} height={12} />
    </div>
  );
}

/**
 * SkeletonPanel — a panel-sized collection of shimmer rows.
 * Drop-in replacement for any card content while data is loading.
 */
export function SkeletonPanel({ title = true, rows = 4 }) {
  return (
    <div className="sk-panel" aria-busy="true" aria-label="Loading…">
      {title && <Skeleton width="44%" height={16} className="sk-title" />}
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/**
 * SkeletonCalendar — matches the MonthlyPnLPanel grid layout.
 * 5 rows × 8 columns (7 day cells + 1 sidebar cell).
 */
export function SkeletonCalendar({ weeks = 5 }) {
  return (
    <div className="sk-calendar" aria-busy="true" aria-label="Loading calendar…">
      {/* Column headers */}
      <div className="sk-cal-header">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={10} width={i === 7 ? '80%' : '60%'} />
        ))}
      </div>

      {/* Week rows */}
      {Array.from({ length: weeks }, (_, w) => (
        <div key={w} className="sk-cal-row">
          {Array.from({ length: 7 }, (_, d) => (
            <div key={d} className="sk-cal-cell">
              <Skeleton width="100%" height="100%" radius="var(--radius-sm)" />
            </div>
          ))}
          {/* Sidebar summary cell */}
          <div className="sk-cal-cell sk-cal-cell--sidebar">
            <Skeleton width="70%" height={11} />
            <Skeleton width="55%" height={13} />
          </div>
        </div>
      ))}
    </div>
  );
}
