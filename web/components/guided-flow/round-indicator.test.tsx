import { render, screen } from "@testing-library/react"
import { RoundIndicator } from "./round-indicator"

function renderIndicator(overrides: Partial<React.ComponentProps<typeof RoundIndicator>> = {}) {
  return render(
    <RoundIndicator
      currentRound={2}
      round1Status="in_progress"
      round2Status="generating"
      round3Status="pending"
      onSelectRound={() => {}}
      {...overrides}
    />
  )
}

describe("RoundIndicator", () => {
  it("shows a round the flow has moved past as complete even if its own status never reached 'complete'", () => {
    // Mirrors the DEC-001 class of decision: round1's tradeoff questions were
    // generated but never answered by a human, so round1Status stays
    // "in_progress" by design (see decision-auto-advance.ts -- questions are
    // generated context, not a human gate) while currentRound has already
    // moved on to round2. The step must read as done, not as still active.
    renderIndicator()

    const round1Button = screen.getByText("preferences").closest("button")
    expect(round1Button).not.toBeNull()
    expect(round1Button).not.toHaveTextContent("1")
  })

  it("still shows the numeral for the actual current round", () => {
    renderIndicator()

    const round2Button = screen.getByText("options").closest("button")
    expect(round2Button).toHaveTextContent("2")
  })

  it("locks a round that has not started yet", () => {
    renderIndicator({ round3Status: "pending" })

    const round3Button = screen.getByText("plan").closest("button")
    expect(round3Button).toBeDisabled()
  })

  it("renders a round already marked complete with a checkmark, not a numeral", () => {
    renderIndicator({ round1Status: "complete" })

    const round1Button = screen.getByText("preferences").closest("button")
    expect(round1Button).not.toHaveTextContent("1")
  })
})
