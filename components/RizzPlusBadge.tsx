import styles from "./RizzPlusBadge.module.css"

/**
 * A membership mark, not a button or a verification check. Compact is a
 * bare color dot; the full form is the "RIZZ+ MEMBER" wordmark — a small
 * "+" right after "RIZZ", echoing the product name, with "MEMBER" on its
 * own smaller line underneath.
 */
export function RizzPlusBadge({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={`${styles.badge} ${compact ? styles.compact : ""} ${className}`} role="img" aria-label="Rizz+ member" title="Rizz+ member">
      {!compact && (
        <span className={styles.label}>
          <span>RIZZ<span className={styles.plus}>+</span></span>
          <span className={styles.member}>MEMBER</span>
        </span>
      )}
    </span>
  )
}
