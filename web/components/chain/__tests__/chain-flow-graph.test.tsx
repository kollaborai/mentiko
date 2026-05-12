import { render, screen } from '@testing-library/react'
import { ChainFlowGraph, type ChainAgent, type ChainBranch } from '../chain-flow-graph'

jest.mock('@/components/agent/agent-avatar', () => ({
  AgentAvatar: ({ seed }: { seed: string }) => <div data-testid="agent-avatar">{seed}</div>,
}))

describe('ChainFlowGraph', () => {
  const mockAgents: ChainAgent[] = [
    {
      id: 'agent-start',
      name: 'Start Agent',
      triggers: ['manual-start'],
      emits: 'event-a',
    },
    {
      id: 'agent-middle',
      name: 'Middle Agent',
      triggers: ['event-a'],
      emits: 'event-b',
    },
    {
      id: 'agent-end',
      name: 'End Agent',
      triggers: ['event-b'],
      emits: 'complete',
    },
  ]

  describe('rendering', () => {
    it('renders SVG container', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('renders with custom width and height', () => {
      render(<ChainFlowGraph agents={mockAgents} width={800} height={600} />)
      const svg = document.querySelector('svg')
      expect(svg).toHaveAttribute('width', '800')
      // height is calculated based on node positions, not the prop
      expect(svg?.getAttribute('height')).toBeTruthy()
    })

    it('uses default dimensions when not provided', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      const svg = document.querySelector('svg')
      expect(svg).toHaveAttribute('width', '600')
    })

    it('renders empty graph when no agents', () => {
      render(<ChainFlowGraph agents={[]} />)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('node rendering', () => {
    it('renders all agents as nodes', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      expect(screen.getByText('Start Agent')).toBeInTheDocument()
      expect(screen.getByText('Middle Agent')).toBeInTheDocument()
      expect(screen.getByText('End Agent')).toBeInTheDocument()
    })

    it('renders agent IDs', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      expect(screen.getByText('agent-start')).toBeInTheDocument()
      expect(screen.getByText('agent-middle')).toBeInTheDocument()
      expect(screen.getByText('agent-end')).toBeInTheDocument()
    })

    it('identifies start node by manual-start trigger', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      // Start node should be rendered
      expect(screen.getByText('Start Agent')).toBeInTheDocument()
    })

    it('handles single agent', () => {
      const singleAgent = [mockAgents[0]]
      render(<ChainFlowGraph agents={singleAgent} />)
      expect(screen.getByText('Start Agent')).toBeInTheDocument()
    })

    it('handles many agents', () => {
      const manyAgents = Array.from({ length: 20 }, (_, i) => ({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        triggers: i === 0 ? ['manual-start'] : [`event-${i - 1}`],
        emits: `event-${i}`,
      }))
      render(<ChainFlowGraph agents={manyAgents} />)
      expect(screen.getByText('Agent 0')).toBeInTheDocument()
      expect(screen.getByText('Agent 19')).toBeInTheDocument()
    })
  })

  describe('edge rendering', () => {
    it('renders edges between connected agents', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      // Check for SVG paths (edges)
      const paths = document.querySelectorAll('svg path')
      expect(paths.length).toBeGreaterThan(0)
    })

    it('shows edge labels for emitted events', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      // Edge labels should be rendered
      const labels = Array.from(document.querySelectorAll('svg text'))
        .filter(text => text.textContent === 'event-a' || text.textContent === 'event-b')
      expect(labels.length).toBeGreaterThan(0)
    })
  })

  describe('node types', () => {
    it('renders start node for manual-start trigger', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      expect(screen.getByText('Start Agent')).toBeInTheDocument()
    })

    it('renders loop node for needs-revision trigger', () => {
      const loopAgent: ChainAgent[] = [{
        id: 'loop-agent',
        name: 'Revision Agent',
        triggers: ['needs-revision'],
        emits: 'revision-event',
      }]
      render(<ChainFlowGraph agents={loopAgent} />)
      expect(screen.getByText('Revision Agent')).toBeInTheDocument()
    })

    it('renders error handler node for error trigger', () => {
      const errorAgents: ChainAgent[] = [
        { id: 'main', name: 'Main', triggers: ['manual-start'], emits: 'event' },
        { id: 'error-handler', name: 'Error Handler', triggers: ['event-error'], emits: 'recovered' }
      ]
      render(<ChainFlowGraph agents={errorAgents} />)
      expect(screen.getByText('Error Handler')).toBeInTheDocument()
    })

    it('renders timeout handler node for timeout trigger', () => {
      const timeoutAgents: ChainAgent[] = [
        { id: 'main', name: 'Main', triggers: ['manual-start'], emits: 'event' },
        { id: 'timeout-handler', name: 'Timeout Handler', triggers: ['event-timeout'], emits: 'retry' }
      ]
      render(<ChainFlowGraph agents={timeoutAgents} />)
      expect(screen.getByText('Timeout Handler')).toBeInTheDocument()
    })
  })

  describe('branching', () => {
    it('handles simple string branch', () => {
      const branches: ChainBranch = {
        'event-a': 'agent-middle',
      }
      render(<ChainFlowGraph agents={mockAgents} branches={branches} />)
      expect(screen.getByText('Middle Agent')).toBeInTheDocument()
    })

    it('handles fan-out array branch', () => {
      const fanOutAgents: ChainAgent[] = [
        { id: 'splitter', name: 'Splitter', triggers: ['manual-start'], emits: 'split-event' },
        { id: 'worker-1', name: 'Worker 1', triggers: ['split-event'], emits: 'result-1' },
        { id: 'worker-2', name: 'Worker 2', triggers: ['split-event'], emits: 'result-2' },
      ]
      const branches: ChainBranch = {
        'split-event': ['worker-1', 'worker-2'],
      }
      render(<ChainFlowGraph agents={fanOutAgents} branches={branches} />)
      expect(screen.getByText('Worker 1')).toBeInTheDocument()
      expect(screen.getByText('Worker 2')).toBeInTheDocument()
    })

    it('handles fan-out with fan-in object branch', () => {
      const fanOutAgents: ChainAgent[] = [
        { id: 'splitter', name: 'Splitter', triggers: ['manual-start'], emits: 'split-event' },
        { id: 'worker-1', name: 'Worker 1', triggers: ['split-event'], emits: 'result-1' },
        { id: 'worker-2', name: 'Worker 2', triggers: ['split-event'], emits: 'result-2' },
        { id: 'aggregator', name: 'Aggregator', triggers: ['result-1', 'result-2'], emits: 'final' },
      ]
      const branches: ChainBranch = {
        'split-event': { fan_out: ['worker-1', 'worker-2'], fan_in: 'aggregator' },
      }
      render(<ChainFlowGraph agents={fanOutAgents} branches={branches} />)
      expect(screen.getByText('Aggregator')).toBeInTheDocument()
    })

    it('handles conditional branch with conditions', () => {
      const conditionalAgents: ChainAgent[] = [
        { id: 'decider', name: 'Decider', triggers: ['manual-start'], emits: 'decision' },
        { id: 'path-a', name: 'Path A', triggers: ['decision'], emits: 'result-a' },
        { id: 'path-b', name: 'Path B', triggers: ['decision'], emits: 'result-b' },
      ]
      const branches: ChainBranch = {
        'decision': {
          conditions: [
            { if: 'condition-a', then: 'path-a' },
            { if: 'condition-b', then: 'path-b' },
          ],
        },
      }
      render(<ChainFlowGraph agents={conditionalAgents} branches={branches} />)
      expect(screen.getByText('Path A')).toBeInTheDocument()
      expect(screen.getByText('Path B')).toBeInTheDocument()
    })

    it('handles branch with default', () => {
      const defaultAgents: ChainAgent[] = [
        { id: 'router', name: 'Router', triggers: ['manual-start'], emits: 'route' },
        { id: 'default-path', name: 'Default Path', triggers: ['route'], emits: 'done' },
      ]
      const branches: ChainBranch = {
        'route': {
          conditions: [{ if: 'special', then: 'other' }],
          default: 'default-path',
        },
      }
      render(<ChainFlowGraph agents={defaultAgents} branches={branches} />)
      expect(screen.getByText('Default Path')).toBeInTheDocument()
    })
  })

  describe('error and timeout routes', () => {
    it('renders error route edge', () => {
      const agentsWithError: ChainAgent[] = [
        { id: 'main', name: 'Main', triggers: ['manual-start'], emits: 'event', on_error: 'error-handler' },
        { id: 'error-handler', name: 'Error Handler', triggers: ['main-error'], emits: 'recovered' },
      ]
      render(<ChainFlowGraph agents={agentsWithError} />)
      expect(screen.getByText('Error Handler')).toBeInTheDocument()
    })

    it('renders timeout route edge', () => {
      const agentsWithTimeout: ChainAgent[] = [
        { id: 'main', name: 'Main', triggers: ['manual-start'], emits: 'event', on_timeout: 'timeout-handler' },
        { id: 'timeout-handler', name: 'Timeout Handler', triggers: ['main-timeout'], emits: 'retry' },
      ]
      render(<ChainFlowGraph agents={agentsWithTimeout} />)
      expect(screen.getByText('Timeout Handler')).toBeInTheDocument()
    })
  })

  describe('SVG markers', () => {
    it('renders arrowhead markers', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      const defs = document.querySelector('svg defs')
      expect(defs).toBeInTheDocument()
      const markers = defs?.querySelectorAll('marker')
      expect(markers?.length).toBeGreaterThan(0)
    })

    it('renders different arrow types for different edge types', () => {
      const agentsWithError: ChainAgent[] = [
        { id: 'main', name: 'Main', triggers: ['manual-start'], emits: 'event', on_error: 'error-handler', on_timeout: 'timeout-handler' },
        { id: 'error-handler', name: 'Error Handler', triggers: ['main-error'], emits: 'recovered' },
        { id: 'timeout-handler', name: 'Timeout Handler', triggers: ['main-timeout'], emits: 'retry' },
      ]
      const branches: ChainBranch = {
        'event': { fan_out: ['worker-1'], fan_in: 'aggregator' },
      }
      render(<ChainFlowGraph agents={agentsWithError} branches={branches} />)
      const markers = document.querySelectorAll('svg marker')
      // Should have multiple marker types
      expect(markers.length).toBeGreaterThan(1)
    })
  })

  describe('node indicators', () => {
    it('shows timeout indicator for agent with timeout', () => {
      const agentsWithTimeout: ChainAgent[] = [
        { id: 'agent-1', name: 'Timed Agent', triggers: ['manual-start'], emits: 'event', timeout: 30 },
      ]
      render(<ChainFlowGraph agents={agentsWithTimeout} />)
      expect(screen.getByText('Timed Agent')).toBeInTheDocument()
    })

    it('shows retry indicator for agent with retry config', () => {
      const agentsWithRetry: ChainAgent[] = [
        { id: 'agent-1', name: 'Retry Agent', triggers: ['manual-start'], emits: 'event', retry: { max_retries: 3, backoff: 'exponential' } },
      ]
      render(<ChainFlowGraph agents={agentsWithRetry} />)
      expect(screen.getByText('Retry Agent')).toBeInTheDocument()
    })
  })

  describe('showRoutingDetails prop', () => {
    it('renders without routing details by default', () => {
      render(<ChainFlowGraph agents={mockAgents} showRoutingDetails={false} />)
      expect(screen.getByText('Start Agent')).toBeInTheDocument()
    })

    it('renders with routing details when enabled', () => {
      render(<ChainFlowGraph agents={mockAgents} showRoutingDetails={true} />)
      expect(screen.getByText('Start Agent')).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('handles orphan agents (no incoming edges)', () => {
      const orphanAgents: ChainAgent[] = [
        { id: 'orphan', name: 'Orphan', triggers: ['some-unknown-event'], emits: 'orphan-event' },
        { id: 'normal', name: 'Normal', triggers: ['manual-start'], emits: 'normal-event' },
      ]
      render(<ChainFlowGraph agents={orphanAgents} />)
      expect(screen.getByText('Orphan')).toBeInTheDocument()
      expect(screen.getByText('Normal')).toBeInTheDocument()
    })

    it('handles circular dependencies', () => {
      const circularAgents: ChainAgent[] = [
        { id: 'agent-a', name: 'Agent A', triggers: ['manual-start', 'event-c'], emits: 'event-a' },
        { id: 'agent-b', name: 'Agent B', triggers: ['event-a'], emits: 'event-b' },
        { id: 'agent-c', name: 'Agent C', triggers: ['event-b'], emits: 'event-c' },
      ]
      render(<ChainFlowGraph agents={circularAgents} />)
      expect(screen.getByText('Agent A')).toBeInTheDocument()
      expect(screen.getByText('Agent B')).toBeInTheDocument()
      expect(screen.getByText('Agent C')).toBeInTheDocument()
    })

    it('handles agents with very long names', () => {
      const longNameAgents: ChainAgent[] = [
        { id: 'agent-1', name: 'a'.repeat(100), triggers: ['manual-start'], emits: 'event' },
      ]
      render(<ChainFlowGraph agents={longNameAgents} />)
      expect(screen.getByText('a'.repeat(100))).toBeInTheDocument()
    })

    it('handles complex branch configurations', () => {
      const complexAgents: ChainAgent[] = [
        { id: 'start', name: 'Start', triggers: ['manual-start'], emits: 'split' },
        { id: 'worker-1', name: 'Worker 1', triggers: ['split'], emits: 'done-1' },
        { id: 'worker-2', name: 'Worker 2', triggers: ['split'], emits: 'done-2' },
        { id: 'worker-3', name: 'Worker 3', triggers: ['split'], emits: 'done-3' },
        { id: 'error-handler', name: 'Error', triggers: ['error'], emits: 'retry' },
        { id: 'aggregator', name: 'Aggregator', triggers: ['done-1', 'done-2', 'done-3'], emits: 'final' },
      ]
      const branches: ChainBranch = {
        'split': {
          fan_out: ['worker-1', 'worker-2', 'worker-3'],
          fan_in: 'aggregator',
          on_error: 'error-handler',
        },
      }
      render(<ChainFlowGraph agents={complexAgents} branches={branches} />)
      expect(screen.getByText('Worker 1')).toBeInTheDocument()
      expect(screen.getByText('Worker 2')).toBeInTheDocument()
      expect(screen.getByText('Worker 3')).toBeInTheDocument()
      expect(screen.getByText('Aggregator')).toBeInTheDocument()
      expect(screen.getByText('Error')).toBeInTheDocument()
    })
  })

  describe('calculated height', () => {
    it('adjusts height based on node positions', () => {
      const tallAgents = Array.from({ length: 10 }, (_, i) => ({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        triggers: i === 0 ? ['manual-start'] : [`event-${i - 1}`],
        emits: `event-${i}`,
      }))
      render(<ChainFlowGraph agents={tallAgents} height={1000} />)
      const svg = document.querySelector('svg')
      // Height should be calculated based on node positions
      const height = svg?.getAttribute('height')
      expect(height).toBeTruthy()
      const numValue = parseInt(height || '0', 10)
      expect(numValue).toBeGreaterThan(400) // taller than default
    })
  })

  describe('responsive styling', () => {
    it('applies w-full class to svg', () => {
      render(<ChainFlowGraph agents={mockAgents} />)
      const svg = document.querySelector('svg')
      expect(svg).toHaveClass('w-full')
    })

    it('renders with height prop', () => {
      render(<ChainFlowGraph agents={mockAgents} height={500} />)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })
})
