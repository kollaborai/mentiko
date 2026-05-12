"use client";

import type { FC } from "react";
import { CloseCircleFilled as X } from "@aliimam/icons";
import { cn } from "@/lib/utils";

export interface UploadedFile {
	id: string;
	name: string;
	size?: number;
	type?: string;
	url?: string;
}

export interface FilePreviewProps {
	files: UploadedFile[];
	onRemove?: (id: string) => void;
	className?: string;
}

export const FilePreview: FC<FilePreviewProps> = ({
	files,
	onRemove,
	className,
}) => {
	if (files.length === 0) return null;

	return (
		<div className={cn("flex flex-wrap gap-2 px-3 pb-2", className)}>
			{files.map((file) => (
				<div
					key={file.id}
					className="flex items-center gap-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 px-2.5 py-1 text-sm text-zinc-700 dark:text-zinc-300"
				>
					<span className="max-w-[150px] truncate">{file.name}</span>
					{onRemove && (
						<button
							type="button"
							onClick={() => onRemove(file.id)}
							className="flex-shrink-0 hover:text-zinc-900 dark:hover:text-white"
							aria-label={`Remove ${file.name}`}
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			))}
		</div>
	);
};

export default FilePreview;
