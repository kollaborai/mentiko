import { screen } from '@testing-library/react'
import { ChainGraph } from '../chain-graph'
import { renderWithNamespace } from '@/lib/test-utils'

// Mock the UI components
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

// Mock @aliimam/icons (component imports TickCircleFilled as CheckCircle2, etc.)
jest.mock('@aliimam/icons', () => ({
  TickCircleFilled: ({ className }: { className?: string }) => (
    <svg data-testid="check-icon" className={className}><circle /></svg>
  ),
  RecordCircleFilled: ({ className }: { className?: string }) => (
    <svg data-testid="circle-icon" className={className}><circle /></svg>
  ),
  InfoCircleFilled: ({ className }: { className?: string }) => (
    <svg data-testid="alert-icon" className={className}><circle /></svg>
  ),
  RotateFilled: ({ className }: { className?: string }) => (
    <svg data-testid="loader-icon" className={className}><circle /></svg>
  ),
}))

describe('ChainGraph', () => {
  const mockAgents = [
    {
      id: 'agent-1',
      name: 'Research Agent',
      role: 'Gathers information',
      triggers: ['manual-start'],
      emits: 'research-complete',
      status: 'complete' as const,
    },
    {
      id: 'agent-2',
      name: 'Writer Agent',
      role: 'Creates content',
      triggers: ['research-complete'],
      emits: 'draft-ready',
      status: 'running' as const,
    },
    {
      id: 'agent-3',
      name: 'Editor Agent',
      role: 'Reviews and edits',
      triggers: ['draft-ready'],
      emits: 'final-doc',
      status: 'pending' as const,
    },
  ]

  describe('rendering', () => {
    it('renders without title', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('renders with title', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} title="Chain Progress" />)
      expect(screen.getByText('Chain Progress')).toBeInTheDocument()
    })

    it('renders all agents', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getByText('Research Agent')).toBeInTheDocument()
      expect(screen.getByText('Writer Agent')).toBeInTheDocument()
      expect(screen.getByText('Editor Agent')).toBeInTheDocument()
    })

    it('renders empty state gracefully', () => {
      renderWithNamespace(<ChainGraph agents={[]} />)
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })
  })

  describe('agent display', () => {
    it('shows agent name', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getByText('Research Agent')).toBeInTheDocument()
    })

    it('shows agent role when present', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getByText('Gathers information')).toBeInTheDocument()
    })

    it('shows agent id in badge', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getByText('agent-1')).toBeInTheDocument()
    })

    it('handles agent without role', () => {
      const agentWithoutRole = [
        {
          id: 'agent-x',
          name: 'Mystery Agent',
          triggers: ['manual-start'],
          emits: 'event',
          status: 'pending' as const,
        },
      ]
      renderWithNamespace(<ChainGraph agents={agentWithoutRole} />)
      expect(screen.getByText('Mystery Agent')).toBeInTheDocument()
    })
  })

  describe('status icons', () => {
    it('shows loader icon for running agent', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getAllByTestId('loader-icon')).toHaveLength(1)
    })

    it('shows check icon for complete agent', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getAllByTestId('check-icon')).toHaveLength(1)
    })

    it('shows circle icon for pending agent', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getAllByTestId('circle-icon')).toHaveLength(1)
    })

    it('shows alert icon for error agent', () => {
      const agentsWithError = [
        {
          id: 'agent-err',
          name: 'Failing Agent',
          triggers: ['manual-start'],
          emits: 'event',
          status: 'error' as const,
        },
      ]
      renderWithNamespace(<ChainGraph agents={agentsWithError} />)
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
    })
  })

  describe('emits display', () => {
    it('shows emits event in badge', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(screen.getByText('research-complete')).toBeInTheDocument()
      expect(screen.getByText('draft-ready')).toBeInTheDocument()
      expect(screen.getByText('final-doc')).toBeInTheDocument()
    })

    it('labels emits section', () => {
      renderWithNamespace(<ChainGraph agents={mockAgents} />)
      const emitsLabels = screen.getAllByText('emits')
      expect(emitsLabels.length).toBeGreaterThan(0)
    })
  })

  describe('connecting lines', () => {
    it('renders separators between agents', () => {
      const { container } = renderWithNamespace(<ChainGraph agents={mockAgents} />)
      const separators = container.querySelectorAll('.bg-border')
      // Should have 2 separators for 3 agents
      expect(separators.length).toBeGreaterThanOrEqual(2)
    })

    it('does not render separator after last agent', () => {
      const { container } = renderWithNamespace(<ChainGraph agents={mockAgents} />)
      const agentCards = container.querySelectorAll('[class*="rounded-md"]')
      // Each agent should be in a card
      expect(agentCards.length).toBe(3)
      // Verify no separator after the last card (separator count = agent count - 1)
      const separators = container.querySelectorAll('.bg-border')
      expect(separators.length).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('handles single agent', () => {
      const singleAgent = [mockAgents[0]]
      renderWithNamespace(<ChainGraph agents={singleAgent} />)
      expect(screen.getByText('Research Agent')).toBeInTheDocument()
    })

    it('handles many agents', () => {
      const manyAgents = Array.from({ length: 10 }, (_, i) => ({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        triggers: [`event-${i - 1}`],
        emits: `event-${i}`,
        status: 'pending' as const,
      }))
      renderWithNamespace(<ChainGraph agents={manyAgents} />)
      // All agents should be rendered
      expect(screen.getAllByText(/Agent \d/).length).toBe(10)
    })

    it('handles agent with special characters in name', () => {
      const specialAgent = [
        {
          id: 'agent-special',
          name: 'Agent <script>alert("xss")</script>',
          triggers: ['start'],
          emits: 'event',
          status: 'pending' as const,
        },
      ]
      renderWithNamespace(<ChainGraph agents={specialAgent} />)
      expect(screen.getByText('Agent <script>alert("xss")</script>')).toBeInTheDocument()
    })
  })

  describe('card structure', () => {
    it('renders card container', () => {
      const { container } = renderWithNamespace(<ChainGraph agents={mockAgents} />)
      expect(container.querySelector('[data-testid="card"]')).toBeInTheDocument()
    })

    it('renders badges for agent IDs', () => {
      const { container } = renderWithNamespace(<ChainGraph agents={mockAgents} />)
      const badges = container.querySelectorAll('[data-testid="badge"]')
      // At minimum, badges for agent IDs
      expect(badges.length).toBeGreaterThanOrEqual(3)
    })
  })
})
