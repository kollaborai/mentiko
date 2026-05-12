import { render, type RenderOptions } from '@testing-library/react'
import { NamespaceProvider } from './namespace-context'

export function renderWithNamespace(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, {
    wrapper: ({ children }) => <NamespaceProvider>{children}</NamespaceProvider>,
    ...options,
  })
}
