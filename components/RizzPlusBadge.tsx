import styles from "./RizzPlusBadge.module.css"

/**
 * A membership mark, not a button or a verification check. No "+" glyph —
 * compact is a bare color dot, the full form is just the "RIZZ MEMBER"
 * wordmark, so the mark itself never repeats the plus sign the product
 * name already carries.
 */
export function RizzPlusBadge({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={`${styles.badge} ${compact ? styles.compact : ""} ${className}`} role="img" aria-label="Rizz+ member" title="Rizz+ member">
      {!compact && <span className={styles.label}>RIZZ<span className={styles.member}>MEMBER</span></span>}
    </span>
  )
}
