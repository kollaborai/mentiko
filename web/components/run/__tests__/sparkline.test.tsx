import { render } from '@testing-library/react'
import { Sparkline, MetricsSparkline } from '../sparkline'

describe('Sparkline', () => {
  describe('rendering', () => {
    it('renders SVG element', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
        { timestamp: 3, value: 15 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('returns null for insufficient data', () => {
      const { container } = render(<Sparkline data={[]} />)
      expect(container.firstChild).toBeNull()
    })

    it('returns null for single data point', () => {
      const { container } = render(
        <Sparkline data={[{ timestamp: 1, value: 10 }]} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders polyline for data points', () => {
      const data = [
        { timestamp: 1, value: 0 },
        { timestamp: 2, value: 100 },
      ]
      const { container } = render(<Sparkline data={data} width={100} height={50} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toBeInTheDocument()
    })

    it('renders circle at end of line', () => {
      const data = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
        { timestamp: 3, value: 25 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const circle = container.querySelector('circle')
      expect(circle).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('uses default color when not specified', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#22c55e')
    })

    it('applies custom color', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} color="#ff0000" />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#ff0000')
    })

    it('uses custom width', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} width={300} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '300')
    })

    it('uses custom height', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} height={80} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('height', '80')
    })
  })

  describe('gradient fill', () => {
    it('renders gradient defs when showGradient is true', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
        { timestamp: 3, value: 15 },
      ]
      const { container } = render(<Sparkline data={data} showGradient={true} />)
      const gradient = container.querySelector('linearGradient')
      expect(gradient).toBeInTheDocument()
    })

    it('renders polygon for filled area when showGradient is true', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} showGradient={true} />)
      const polygon = container.querySelector('polygon')
      expect(polygon).toBeInTheDocument()
    })

    it('does not render polygon when showGradient is false', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} showGradient={false} />)
      const polygon = container.querySelector('polygon')
      expect(polygon).not.toBeInTheDocument()
    })

    it('generates unique gradient ID based on color', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} color="#ff00ff" showGradient={true} />)
      const gradient = container.querySelector('linearGradient')
      expect(gradient).toHaveAttribute('id', 'sparkline-gradient-ff00ff')
    })
  })

  describe('edge cases', () => {
    it('handles all zero values', () => {
      const data = [
        { timestamp: 1, value: 0 },
        { timestamp: 2, value: 0 },
        { timestamp: 3, value: 0 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toBeInTheDocument()
    })

    it('handles negative values', () => {
      const data = [
        { timestamp: 1, value: -50 },
        { timestamp: 2, value: 0 },
        { timestamp: 3, value: 50 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toBeInTheDocument()
    })

    it('handles very large values', () => {
      const data = [
        { timestamp: 1, value: 999999 },
        { timestamp: 2, value: 1000000 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toBeInTheDocument()
    })

    it('handles single repeated value', () => {
      const data = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 50 },
        { timestamp: 3, value: 50 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toBeInTheDocument()
    })

    it('handles many data points', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        timestamp: i,
        value: Math.random() * 100,
      }))
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toBeInTheDocument()
    })

    it('handles special color characters in gradient ID', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} color="#123-ABC" showGradient={true} />)
      const gradient = container.querySelector('linearGradient')
      expect(gradient).toHaveAttribute('id')
    })
  })

  describe('line attributes', () => {
    it('sets stroke width to 2', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke-width', '2')
    })

    it('sets linecap to round', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke-linecap', 'round')
    })

    it('sets linejoin to round', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke-linejoin', 'round')
    })

    it('sets vector effect to non-scaling-stroke', () => {
      const data = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]
      const { container } = render(<Sparkline data={data} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('vector-effect', 'non-scaling-stroke')
    })
  })
})

describe('MetricsSparkline', () => {
  describe('type-based coloring', () => {
    it('uses green color for cpu type', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} type="cpu" />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#22c55e')
    })

    it('uses blue color for memory type', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} type="memory" />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#3b82f6')
    })

    it('uses purple color for tokens type', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} type="tokens" />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#a855f7')
    })

    it('uses yellow color for cost type', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} type="cost" />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#eab308')
    })

    it('uses orange color for duration type', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} type="duration" />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#f97316')
    })
  })

  describe('props passthrough', () => {
    it('passes width prop to Sparkline', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} width={150} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '150')
    })

    it('passes height prop to Sparkline', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} height={60} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('height', '60')
    })

    it('defaults to cpu type when not specified', () => {
      const metrics = [
        { timestamp: 1, value: 50 },
        { timestamp: 2, value: 75 },
      ]
      const { container } = render(<MetricsSparkline metrics={metrics} />)
      const polyline = container.querySelector('polyline')
      expect(polyline).toHaveAttribute('stroke', '#22c55e')
    })
  })

  describe('edge cases', () => {
    it('handles empty metrics', () => {
      const { container } = render(<MetricsSparkline metrics={[]} />)
      expect(container.firstChild).toBeNull()
    })

    it('handles single metric point', () => {
      const { container } = render(
        <MetricsSparkline metrics={[{ timestamp: 1, value: 50 }]} />
      )
      expect(container.firstChild).toBeNull()
    })
  })
})
