import type { ComponentProps } from "react";
import { CommandSquareFilled } from "@aliimam/icons";

export type TerminalIconProps = ComponentProps<typeof CommandSquareFilled>;

export function TerminalIcon(props: TerminalIconProps) {
  return <CommandSquareFilled {...props} />;
}
