import { screen, fireEvent } from '@testing-library/react'
import { StateInspector } from '../state-inspector'
import { renderWithNamespace } from '@/lib/test-utils'

// Mock UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className, variant }: { children: React.ReactNode; className?: string; variant?: string }) => (
    <span data-testid="badge" data-variant={variant} className={className}>{children}</span>
  ),
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, size, variant }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string; size?: string; variant?: string }) => (
    <button data-testid="button" onClick={onClick} disabled={disabled} className={className}>{children}</button>
  ),
}))

// Mock @aliimam/icons
jest.mock('@aliimam/icons', () => ({
  ArrowDown2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-down-icon" className={className} />
  ),
  ArrowRight2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-right-icon" className={className} />
  ),
  BotMessageSquare: ({ className }: { className?: string }) => (
    <svg data-testid="bot-icon" className={className} />
  ),
  DataFilled: ({ className }: { className?: string }) => (
    <svg data-testid="data-icon" className={className} />
  ),
  DocumentTextFilled: ({ className }: { className?: string }) => (
    <svg data-testid="doc-icon" className={className} />
  ),
  ActivityFilled: ({ className }: { className?: string }) => (
    <svg data-testid="activity-icon" className={className} />
  ),
  ClockFilled: ({ className }: { className?: string }) => (
    <svg data-testid="clock-icon" className={className} />
  ),
  RefreshFilled: ({ className }: { className?: string }) => (
    <svg data-testid="refresh-icon" className={className} />
  ),
  SearchNormalFilled: ({ className }: { className?: string }) => (
    <svg data-testid="search-icon" className={className} />
  ),
  ArrowLeft2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-left-icon" className={className} />
  ),
}))

// Mock useNamespaceFetch
const mockFetchWithNamespace = jest.fn()
jest.mock('@/lib/use-namespace-fetch', () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}))

// Mock unwrapApiData to extract data from API wrapper
jest.mock('@/lib/api-client', () => ({
  unwrapApiData: (data: { success: boolean; data: unknown }) => data.data,
}))

function mockStateResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        run_id: 'test-run',
        chain_id: 'test-chain',
        status: 'paused',
        current_agent: null,
        variables: {
          global: {
            run_id: { value: 'test-run', type: 'string', updated_at: '2026-05-14T00:00:00Z', source: 'system' },
          },
          chain: {
            chain_name: { value: 'test-chain', type: 'string', updated_at: '2026-05-14T00:00:00Z', source: 'chain' },
          },
          agent: {
            memory: { value: 'some data', type: 'string', updated_at: '2026-05-14T00:00:00Z', source: 'agent-1' },
          },
        },
        recent_output: [],
        pending_events: [],
        ...overrides,
      },
    }),
  }
}

describe('StateInspector', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders idle state without throwing', async () => {
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          run_id: 'test-run',
          chain_id: 'test-chain',
          status: 'idle',
          current_agent: null,
          variables: { global: {}, chain: {}, agent: {} },
          recent_output: [],
          pending_events: [],
        },
      }),
    })

    renderWithNamespace(<StateInspector chainId="test-chain" paused={false} />)

    // Should show "state inspector" header
    expect(screen.getByText('state inspector')).toBeInTheDocument()
    // Should show idle badge (wait for async fetch to complete)
    expect(await screen.findByText('idle')).toBeInTheDocument()
  })

  it('renders agent vars section with correct section key', async () => {
    mockFetchWithNamespace.mockResolvedValue(mockStateResponse())

    renderWithNamespace(<StateInspector chainId="test-chain" paused={false} />)

    // Wait for data to load — title is rendered as-is (CSS uppercase handles display)
    const agentVarsTitle = await screen.findByText('agent vars')
    expect(agentVarsTitle).toBeInTheDocument()

    // Agent variable should be visible (expanded by default)
    expect(screen.getByText('memory')).toBeInTheDocument()
  })

  it('toggles agent vars section collapse/expand', async () => {
    mockFetchWithNamespace.mockResolvedValue(mockStateResponse())

    renderWithNamespace(<StateInspector chainId="test-chain" paused={false} />)

    // Wait for data to load
    await screen.findByText('agent vars')

    // Click to collapse agent vars
    const agentVarsButton = screen.getByText('agent vars').closest('button')!
    fireEvent.click(agentVarsButton)

    // Agent variable should now be hidden
    expect(screen.queryByText('memory')).not.toBeInTheDocument()

    // Click to expand again
    fireEvent.click(agentVarsButton)

    // Agent variable should be visible again
    expect(screen.getByText('memory')).toBeInTheDocument()
  })

  it('toggles global and chain sections independently', async () => {
    mockFetchWithNamespace.mockResolvedValue(mockStateResponse())

    renderWithNamespace(<StateInspector chainId="test-chain" paused={false} />)

    // Wait for data
    await screen.findByText('global')

    // Collapse global
    const globalButton = screen.getByText('global').closest('button')!
    fireEvent.click(globalButton)
    expect(screen.queryByText('run_id')).not.toBeInTheDocument()

    // Chain should still be expanded
    expect(screen.getByText('chain_name')).toBeInTheDocument()

    // Collapse chain
    const chainButton = screen.getByText('chain').closest('button')!
    fireEvent.click(chainButton)
    expect(screen.queryByText('chain_name')).not.toBeInTheDocument()

    // Agent vars should still be expanded
    expect(screen.getByText('memory')).toBeInTheDocument()
  })

  it('shows error state when fetch fails', async () => {
    mockFetchWithNamespace.mockResolvedValue({
      ok: false,
      text: async () => 'fetch failed',
    })

    renderWithNamespace(<StateInspector chainId="test-chain" paused={false} />)

    expect(await screen.findByText('fetch failed')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    mockFetchWithNamespace.mockReturnValue(new Promise(() => {})) // never resolves

    renderWithNamespace(<StateInspector chainId="test-chain" paused={false} />)

    expect(screen.getByText('loading state...')).toBeInTheDocument()
  })
})
