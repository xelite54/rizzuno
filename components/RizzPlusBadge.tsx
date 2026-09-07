import styles from "./RizzPlusBadge.module.css"

/** A membership mark, not a button or a verification check. */
export function RizzPlusBadge({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={`${styles.badge} ${compact ? styles.compact : ""} ${className}`} role="img" aria-label="Rizz+ member" title="Rizz+ member">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="m14.8 3.4 1.8 1.8M3.4 14.8l1.8 1.8" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      {!compact && <span className={styles.label}>RIZZ<span className={styles.member}>MEMBER</span></span>}
    </span>
  )
}
