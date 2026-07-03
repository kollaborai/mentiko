import type { ComponentProps } from "react";
import { Code1Filled } from "@aliimam/icons";

export type TerminalIconProps = ComponentProps<typeof Code1Filled>;

export function TerminalIcon(props: TerminalIconProps) {
  return <Code1Filled {...props} />;
}
