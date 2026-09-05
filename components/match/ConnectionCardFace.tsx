/** Shared vector artwork keeps the favicon and animated wordmark consistent. */
export function ConnectionCardFace({ front = false }: { front?: boolean }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 24 34" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="22.5" height="32.5" rx="5" fill={front ? "#943F5D" : "#382C45"} stroke={front ? "#C87994" : "#766482"} strokeWidth="1.5" />
      {front && (
        <path d="M12 23.5C9.6 21.5 5.5 18.5 5.5 14.7C5.5 10.8 10.3 9.8 12 13.1C13.7 9.8 18.5 10.8 18.5 14.7C18.5 18.5 14.4 21.5 12 23.5Z" stroke="#F6DCE5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}
