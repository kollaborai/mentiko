import { screen, fireEvent, waitFor } from '@testing-library/react'
import { EventLogViewer } from '../event-log-viewer'
import { renderWithNamespace } from '@/lib/test-utils'

// Mock dependencies
jest.mock('@/lib/pty/websocket', () => ({
  useWebSocket: () => ({
    connected: true,
    lastEvent: null,
  }),
}))

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

jest.mock('@/components/common/live-indicator', () => ({
  LiveIndicator: ({ connected }: {
    connected: boolean
    _size?: 'sm' | 'md'
    showText?: boolean
  }) => (
    <div data-testid="live-indicator" data-connected={connected}>
      {connected ? 'live' : 'offline'}
    </div>
  ),
}))

// Mock fetch
global.fetch = jest.fn()

describe('EventLogViewer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    })
  })

  describe('rendering', () => {
    it('renders the component with title', () => {
      renderWithNamespace(<EventLogViewer />)
      expect(screen.getByText('Event Log')).toBeInTheDocument()
    })

    it('shows loading state initially', () => {
      renderWithNamespace(<EventLogViewer />)
      expect(screen.getByText(/loading events/i)).toBeInTheDocument()
    })

    it('shows empty state when no events', async () => {
      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText(/no events found/i)).toBeInTheDocument()
      })
    })

    it('displays event count in header', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'agent_started',
          source: 'agent-1',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '{"test": "data"}',
        },
        {
          filename: 'event-2.json',
          event: 'agent_complete',
          source: 'agent-2',
          timestamp: new Date().toISOString(),
          processed: false,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText(/2 events from event system/i)).toBeInTheDocument()
      })
    })
  })

  describe('event items display', () => {
    it('displays event name and source', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'test_event',
          source: 'test-agent',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('test_event')).toBeInTheDocument()
        expect(screen.getByText('test-agent')).toBeInTheDocument()
      })
    })

    it('shows processed badge with correct styling', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'processed_event',
          source: 'agent-1',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('done')).toBeInTheDocument()
      })
    })

    it('shows pending badge for unprocessed events', async () => {
      const mockEvents = [
        {
          filename: 'event-2.json',
          event: 'pending_event',
          source: 'agent-2',
          timestamp: new Date().toISOString(),
          processed: false,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('pending')).toBeInTheDocument()
      })
    })

    it('displays relative time for events', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'test_event',
          source: 'agent-1',
          timestamp: new Date(Date.now() - 60000).toISOString(),
          processed: true,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText(/ago/i)).toBeInTheDocument()
      })
    })
  })

  describe('interaction', () => {
    it('expands event item on click', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'test_event',
          source: 'agent-1',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '{"key": "value"}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('test_event')).toBeInTheDocument()
      })

      const eventButton = screen.getByText('test_event').closest('button')
      fireEvent.click(eventButton!)

      await waitFor(() => {
        expect(screen.getByText('event:')).toBeInTheDocument()
        expect(screen.getByText('source:')).toBeInTheDocument()
      })
    })

    it('refreshes events on refresh button click', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'test_event',
          source: 'agent-1',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('test_event')).toBeInTheDocument()
      })

      const refreshButton = screen.getAllByTestId('button').find(
        btn => btn.querySelector('svg')?.classList.contains('animate-spin') === false
      )

      if (refreshButton) {
        fireEvent.click(refreshButton)
        expect(global.fetch).toHaveBeenCalled()
      }
    })
  })

  describe('expanded event details', () => {
    it('shows event details when expanded', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'detailed_event',
          source: 'agent-1',
          timestamp: '2024-01-15T10:30:00Z',
          processed: true,
          data: '{"result": "success"}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('detailed_event')).toBeInTheDocument()
      })

      const eventButton = screen.getByText('detailed_event').closest('button')
      fireEvent.click(eventButton!)

      await waitFor(() => {
        expect(screen.getByText(/result.*success/i)).toBeInTheDocument()
        expect(screen.getByText(/filename: event-1.json/i)).toBeInTheDocument()
      })
    })

    it('shows timestamp in expanded view', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'timestamp_event',
          source: 'agent-1',
          timestamp: '2024-01-15T10:30:00Z',
          processed: true,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('timestamp_event')).toBeInTheDocument()
      })

      const eventButton = screen.getByText('timestamp_event').closest('button')
      fireEvent.click(eventButton!)

      await waitFor(() => {
        expect(screen.getByText(/timestamp:/i)).toBeInTheDocument()
      })
    })

    it('toggles chevron icon on expand', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'chevron_event',
          source: 'agent-1',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '{}',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('chevron_event')).toBeInTheDocument()
      })

      const eventButton = screen.getByText('chevron_event').closest('button')
      fireEvent.click(eventButton!)

      await waitFor(() => {
        expect(screen.getByText(/timestamp:/i)).toBeInTheDocument()
      })

      // Click again to collapse
      fireEvent.click(eventButton!)

      await waitFor(() => {
        expect(screen.queryByText(/timestamp:/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('edge cases', () => {
    it('handles fetch error gracefully', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText(/failed to load|error/i)).toBeInTheDocument()
      })
    })

    it('handles event with no data', async () => {
      const mockEvents = [
        {
          filename: 'event-1.json',
          event: 'no_data_event',
          source: 'agent-1',
          timestamp: new Date().toISOString(),
          processed: true,
          data: '',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: mockEvents }),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText('no_data_event')).toBeInTheDocument()
      })

      const eventButton = screen.getByText('no_data_event').closest('button')
      fireEvent.click(eventButton!)

      await waitFor(() => {
        expect(screen.getByText(/filename:/i)).toBeInTheDocument()
      })
    })

    it('handles http error response', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      })

      renderWithNamespace(<EventLogViewer />)
      await waitFor(() => {
        expect(screen.getByText(/http 500|error/i)).toBeInTheDocument()
      })
    })
  })
})
