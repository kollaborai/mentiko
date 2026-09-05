/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");

// @aliimam/logos ships with a broken "main" field (dist/index.cjs doesn't
// exist in the published package — same root cause @aliimam/icons already
// has this sibling mock for). Mirrors icons.js: a stub SVG for every named
// export, so any component that renders a provider logo (ProviderLogo,
// steps/cli-setup-step.tsx, aider-auth.tsx, settings/agent-configs) is
// testable without depending on the upstream package being fixed/republished.
module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== "string" || name === "__esModule") return undefined;
      if (!_target[name]) {
        const Component = React.forwardRef(function MockLogo(props, ref) {
          return React.createElement("svg", { ...props, ref, "data-testid": `logo-${name}` });
        });
        Component.displayName = name;
        _target[name] = Component;
      }
      return _target[name];
    },
  }
);
