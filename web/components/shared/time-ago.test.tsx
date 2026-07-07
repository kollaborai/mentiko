import { render, screen } from "@testing-library/react"
import { TimeAgo } from "./time-ago"

describe("TimeAgo", () => {
  it("renders a fallback instead of crashing for missing dates", () => {
    expect(() => render(<TimeAgo date={undefined} />)).not.toThrow()

    expect(screen.getByText("unknown")).toBeInTheDocument()
  })

  it("renders a fallback instead of crashing for invalid dates", () => {
    render(<TimeAgo date="not-a-date" fallback="never" />)

    expect(screen.getByText("never")).toBeInTheDocument()
  })

  it("renders valid dates with a datetime attribute", () => {
    render(<TimeAgo date="2026-07-06T20:00:00.000Z" />)

    expect(screen.getByText(/ago|second|minute|hour|day|week|month|year/)).toHaveAttribute(
      "datetime",
      "2026-07-06T20:00:00.000Z"
    )
  })
})
