import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScheduleList } from '../schedule-list'

jest.mock('@/lib/ui-context/workspace-context', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-ws',
    workspacePath: '/tmp/test',
    setWorkspaceId: jest.fn(),
    workspaces: [],
    refetch: jest.fn(),
  }),
}))

// Mock dependencies
const mockFetchWithNamespace = jest.fn()

jest.mock('@/lib/hooks/use-namespace-fetch', () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
  }) => (
    <button onClick={onClick} disabled={disabled} className={className} data-testid="button">
      {children}
    </button>
  ),
}))

jest.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, className }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    className?: string
  }) => (
    <button
      onClick={() => onCheckedChange?.(!checked)}
      className={className}
      data-checked={checked}
      data-testid="switch"
    >
      {checked ? 'on' : 'off'}
    </button>
  ),
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: {
    children: React.ReactNode
    variant?: string
    className?: string
  }) => (
    <span data-testid={`badge-${variant}`} className={className}>{children}</span>
  ),
}))

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, className }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className} data-testid="alert">{children}</div>,
  AlertDescription: ({ children }: {
    children: React.ReactNode
  }) => <div>{children}</div>,
}))

jest.mock('@/components/shared/time-ago', () => ({
  TimeAgo: ({ format }: {
    _date?: string
    format?: string
    _suffix?: string
  }) => <span>{format} ago</span>,
}))

jest.mock('@/lib/schedules/schedule-utils', () => ({
  formatNextRun: (_date: string) => 'in 2 hours',
  getSnoozeRemaining: (_date: string) => '25min',
}))

describe('ScheduleList', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({ schedules: [] }),
    })
  })

  describe('rendering', () => {
    it('shows loading state initially', () => {
      mockFetchWithNamespace.mockImplementation(() => new Promise(() => {}))
      render(<ScheduleList />)
      // Check for skeleton elements with animate-pulse class
      const skeletons = document.querySelectorAll('.animate-pulse')
      expect(skeletons.length).toBe(3)
    })

    it('shows empty state when no schedules', async () => {
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: [] }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText(/no scheduled chains found/i)).toBeInTheDocument()
      })
    })

    it('displays schedule list when schedules exist', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Test Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: new Date(Date.now() - 3600000).toISOString(),
          nextRun: new Date(Date.now() + 3600000).toISOString(),
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Test Chain')).toBeInTheDocument()
      })
    })
  })

  describe('schedule items', () => {
    it('displays chain name and schedule', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'My Chain',
          schedule: '0 0 * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('My Chain')).toBeInTheDocument()
        expect(screen.getByText('0 0 * * *')).toBeInTheDocument()
      })
    })

    it('shows status badge for each schedule', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Active Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument()
      })
    })

    it('shows timezone for schedule', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'TZ Chain',
          schedule: '0 * * * *',
          timezone: 'America/New_York',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('America/New_York')).toBeInTheDocument()
      })
    })
  })

  describe('interaction', () => {
    it('toggles schedule on switch click', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Toggle Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Toggle Chain')).toBeInTheDocument()
      })

      const toggle = screen.getByTestId('switch')
      fireEvent.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveAttribute('data-checked', 'false')
      })
    })

    it('calls onEdit when edit button clicked', async () => {
      const mockOnEdit = jest.fn()
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Editable Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList onEdit={mockOnEdit} />)
      await waitFor(() => {
        expect(screen.getByText('Editable Chain')).toBeInTheDocument()
      })

      const editButton = screen.getByText('Edit')
      fireEvent.click(editButton)

      expect(mockOnEdit).toHaveBeenCalledWith(mockSchedules[0])
    })

    it('calls onHistory when history button clicked', async () => {
      const mockOnHistory = jest.fn()
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'History Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: new Date().toISOString(),
          nextRun: null,
          runCount: 10,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList onHistory={mockOnHistory} />)
      await waitFor(() => {
        expect(screen.getByText('History Chain')).toBeInTheDocument()
      })

      const historyButton = screen.getByText('History')
      fireEvent.click(historyButton)

      expect(mockOnHistory).toHaveBeenCalledWith(mockSchedules[0])
    })
  })

  describe('schedule statuses', () => {
    it('shows active badge for enabled schedules', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Active Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument()
      })
    })

    it('shows paused badge for disabled schedules', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Paused Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: false,
          status: 'disabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Paused')).toBeInTheDocument()
      })
    })

    it('shows snoozed badge for snoozed schedules', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Snoozed Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: false,
          status: 'snoozed' as const,
          snoozedUntil: new Date(Date.now() + 1800000).toISOString(),
          lastRun: null,
          nextRun: null,
        },
      ]
      mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Snoozed')).toBeInTheDocument()
        expect(screen.getByText('Snoozed Chain')).toBeInTheDocument()
      })
    })
  })

  describe('conflict detection', () => {
    it('shows conflict alert when detected', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Conflict Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
          conflictDetected: true,
          conflictingChains: ['chain-2', 'chain-3'],
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText(/conflicts with:/i)).toBeInTheDocument()
        expect(screen.getByText(/chain-2, chain-3/i)).toBeInTheDocument()
      })
    })
  })

  describe('edge cases', () => {
    it('handles schedule with no last run', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'No Run Chain',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: new Date().toISOString(),
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('No Run Chain')).toBeInTheDocument()
      })
    })

    it('handles schedule with zero run count', async () => {
      const mockSchedules = [
        {
          chainId: 'chain-1',
          chainName: 'Zero Runs',
          schedule: '0 * * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'enabled' as const,
          snoozedUntil: null,
          lastRun: null,
          nextRun: null,
          runCount: 0,
        },
      ]
      ;mockFetchWithNamespace.mockResolvedValue({
        ok: true,
        json: async () => ({ schedules: mockSchedules }),
      })

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.getByText('Zero Runs')).toBeInTheDocument()
      })
    })

    it('handles fetch error gracefully', async () => {
      ;mockFetchWithNamespace.mockRejectedValue(new Error('Network error'))

      render(<ScheduleList />)
      await waitFor(() => {
        expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
      })
    })
  })
})
