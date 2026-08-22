"use client"

import { useState } from "react"
import { MaleIcon, FemaleIcon } from "@/components/icons"
import type { Gender } from "@/hooks/useMyProfile"

type ChooseGenderProps = {
  onChosen: (gender: Gender) => void
}

/**
 * The second required onboarding step, right after choosing a username —
 * two plain icon buttons rather than a dropdown, since there are only two
 * options. Changeable later from My Profile, so getting it right now isn't
 * a one-shot decision.
 */
export function ChooseGender({ onChosen }: ChooseGenderProps) {
  const [selected, setSelected] = useState<Gender | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    onChosen(selected)
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">Choose your gender</h1>
        <p className="mt-1.5 text-[13px] text-muted">Shown on your profile. You can change this later.</p>

        <form onSubmit={handleSubmit} className="mt-6">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelected("male")}
              aria-pressed={selected === "male"}
              className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                selected === "male"
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <MaleIcon className="h-7 w-7" />
              <span className="text-[13px] font-medium">Male</span>
            </button>
            <button
              type="button"
              onClick={() => setSelected("female")}
              aria-pressed={selected === "female"}
              className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                selected === "female"
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <FemaleIcon className="h-7 w-7" />
              <span className="text-[13px] font-medium">Female</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={!selected}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[14px] font-semibold text-background transition-all duration-200 hover:-translate-y-px hover:brightness-95 active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:pointer-events-none disabled:opacity-40"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  )
}
