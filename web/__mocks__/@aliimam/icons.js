/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");

// Return a stub SVG component for every named export
module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== "string" || name === "__esModule") return undefined;
      // Cache the component so the same reference is returned each time
      if (!_target[name]) {
        const Component = React.forwardRef(function MockIcon(props, ref) {
          return React.createElement("svg", { ...props, ref, "data-testid": `icon-${name}` });
        });
        Component.displayName = name;
        _target[name] = Component;
      }
      return _target[name];
    },
  }
);
