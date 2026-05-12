"use client";

import type { FC } from "react";
import { RecordCircleFilled as Circle } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { Composer } from "@/components/ui/composer";

export interface SessionComposerProps {
	/** Placeholder text */
	placeholder?: string;
	/** Whether the session is online/enabled */
	online?: boolean;
	/** Session name to display */
	sessionName?: string;
	/** Callback when message is submitted */
	onSubmit?: (message: string) => void | Promise<void>;
	/** Additional className */
	className?: string;
}

export const SessionComposer: FC<SessionComposerProps> = ({
	placeholder = "Type a message...",
	online = false,
	sessionName,
	onSubmit,
	className,
}) => {
	return (
		<div className={cn("space-y-2", className)}>
			{/* Session status indicator */}
			<div className="flex items-center gap-2 px-1">
				<Circle
					className={cn(
						"h-2 w-2 shrink-0",
						online
							? "text-green-500 fill-green-500"
							: "text-foreground/30 fill-foreground/30"
					)}
				/>
				{sessionName ? (
					<span className="text-xs font-mono text-foreground/50">
						{sessionName}
					</span>
				) : (
					<span className="text-xs text-foreground/30">
						{online ? "active session" : "no active session"}
					</span>
				)}
			</div>

			{/* Rich composer with tools, slash commands, etc. */}
			<Composer
				placeholder={online ? placeholder : "Send to resume session..."}
				onSubmit={onSubmit}
				disabled={false}
				showToolsButton={online}
				tools={[]}
			/>
		</div>
	);
};
