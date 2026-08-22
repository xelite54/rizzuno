// Shared motion tuning so menus, sheets, popovers, and backdrops across the
// app move like one consistent, unhurried interface rather than a patchwork
// of ad hoc durations — a relaxed ease-out rather than framer-motion's
// snappier default, used everywhere something fades or slides into place.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const

export const DURATION_QUICK = 0.18
export const DURATION_BASE = 0.26
export const DURATION_SLOW = 0.34
