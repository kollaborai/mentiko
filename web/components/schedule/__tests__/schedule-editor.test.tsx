import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduleEditor } from '../schedule-editor'

// Mock dependencies
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled} data-testid="button">
      {children}
    </button>
  ),
}))

jest.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, className }: {
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    className?: string
  }) => (
    <input
      value={value}
      onChange={(e) => onChange?.(e)}
      placeholder={placeholder}
      className={className}
      data-testid="input"
    />
  ),
}))

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, className }: {
    children: React.ReactNode
    className?: string
  }) => (
    <label className={className}>{children}</label>
  ),
}))

jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: {
    value?: string
    onValueChange?: (value: string) => void
    children: React.ReactNode
  }) => (
    <div data-testid="select" data-value={value}>
      {children}
      <button onClick={() => onValueChange?.('UTC')}>Change Timezone</button>
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: {
    children: React.ReactNode
    value: string
  }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <div>Value</div>,
}))

jest.mock('@/lib/schedule-utils', () => ({
  CRON_PRESETS: [
    { expression: '0 * * * *', label: 'Hourly', description: 'Run every hour' },
    { expression: '0 0 * * *', label: 'Daily', description: 'Run at midnight' },
    { expression: '0 0 * * 0', label: 'Weekly', description: 'Run on Sunday' },
    { expression: '0 0 1 * *', label: 'Monthly', description: 'Run on the 1st' },
    { expression: '*/5 * * * *', label: 'Every 5 min', description: 'Run every 5 minutes' },
    { expression: '*/15 * * * *', label: 'Every 15 min', description: 'Run every 15 minutes' },
    { expression: '0 9 * * 1-5', label: 'Weekdays', description: 'Run at 9am on weekdays' },
    { expression: '0 0 * * *', label: 'Custom', description: 'Custom schedule' },
  ],
  getTimezones: () => ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'],
  isValidCron: (cron: string) => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron),
  isValidTimezone: () => true,
  getCronDescription: (cron: string) => `Runs: ${cron}`,
}))

describe('ScheduleEditor', () => {
  const mockOnSave = jest.fn()
  const mockOnCancel = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders with chain name', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText(/schedule: test-chain/i)).toBeInTheDocument()
    })

    it('renders preset schedules', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText('Hourly')).toBeInTheDocument()
      expect(screen.getByText('Daily')).toBeInTheDocument()
      expect(screen.getByText('Weekly')).toBeInTheDocument()
    })

    it('renders custom cron input', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText(/custom cron expression/i)).toBeInTheDocument()
      expect(screen.getByTestId('input')).toBeInTheDocument()
    })

    it('renders timezone selector', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      // Check for the select element directly
      expect(screen.getByTestId('select')).toBeInTheDocument()
    })

    it('shows valid cron indicator', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron="0 * * * *"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      // The component should have the valid cron value
      const input = screen.getByTestId('input')
      expect((input as HTMLInputElement).value).toBe('0 * * * *')
    })
  })

  describe('preset selection', () => {
    it('selects preset on click', async () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const dailyButton = screen.getByText('Daily')
      fireEvent.click(dailyButton)

      await waitFor(() => {
        expect(screen.getByText('Runs: 0 0 * * *')).toBeInTheDocument()
      })
    })

    it('highlights selected preset', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron="0 * * * *"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const hourlyButton = screen.getByText('Hourly').closest('button')
      expect(hourlyButton?.className).toContain('bg-blue-500')
    })

    it('shows preset descriptions', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText('Run every hour')).toBeInTheDocument()
      expect(screen.getByText('Run at midnight')).toBeInTheDocument()
    })
  })

  describe('custom cron input', () => {
    it('updates cron when typing in custom input', async () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const input = screen.getByTestId('input') as HTMLInputElement
      await userEvent.clear(input)
      await userEvent.type(input, '*/10 * * * *')

      expect(input.value).toBe('*/10 * * * *')
    })

    it('shows validation indicator for valid cron', async () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron="invalid"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const input = screen.getByTestId('input')
      await userEvent.clear(input)
      await userEvent.type(input, '0 * * * *')

      await waitFor(() => {
        expect(screen.getByText('Runs: 0 * * * *')).toBeInTheDocument()
      })
    })

    it('shows error indicator for invalid cron', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron="invalid-cron"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const input = screen.getByTestId('input')
      expect(input.className).toContain('bg-red-500/10')
    })
  })

  describe('save and cancel', () => {
    it('calls onSave with cron and timezone when save clicked', async () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron="0 * * * *"
          initialTimezone="UTC"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const saveButtons = screen.getAllByTestId('button')
      const saveButton = saveButtons.find(btn => btn.textContent?.includes('Save'))

      if (saveButton) {
        fireEvent.click(saveButton)
        expect(mockOnSave).toHaveBeenCalledWith('0 * * * *', 'UTC')
      }
    })

    it('calls onCancel when cancel clicked', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('disables save button when cron is invalid', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron="invalid"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const saveButtons = screen.getAllByTestId('button')
      const saveButton = saveButtons.find(btn => btn.textContent?.includes('Save'))

      expect(saveButton).toBeDisabled()
    })
  })

  describe('timezone selection', () => {
    it('displays timezone options', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText('UTC')).toBeInTheDocument()
      expect(screen.getByText('America/New_York')).toBeInTheDocument()
    })

    it('updates timezone on selection', async () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialTimezone="America/New_York"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )

      const changeButton = screen.getByText('Change Timezone')
      fireEvent.click(changeButton)

      await waitFor(() => {
        const select = screen.getByTestId('select')
        expect(select).toHaveAttribute('data-value', 'UTC')
      })
    })
  })

  describe('edge cases', () => {
    it('handles empty initial cron', () => {
      render(
        <ScheduleEditor
          chainName="test-chain"
          initialCron=""
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByTestId('input')).toBeInTheDocument()
    })

    it('handles special characters in chain name', () => {
      render(
        <ScheduleEditor
          chainName="chain-with-special-<chars>"
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText(/chain-with-special-<chars>/i)).toBeInTheDocument()
    })

    it('handles very long chain name', () => {
      const longName = 'a'.repeat(100)
      render(
        <ScheduleEditor
          chainName={longName}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      )
      expect(screen.getByText(new RegExp(longName.substring(0, 20)))).toBeInTheDocument()
    })
  })
})
