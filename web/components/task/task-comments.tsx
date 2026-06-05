"use client";

import { useState } from "react";
import { SendFilled as Send } from "@aliimam/icons";
import { timeAgo } from "@/lib/tasks/task-transforms";
import type { TaskComment } from "@/lib/tasks/task-types";

interface TaskCommentsProps {
  taskId: string;
  comments: TaskComment[];
  onAddComment: (text: string) => Promise<void>;
}

export function TaskComments({
  comments,
  onAddComment,
}: TaskCommentsProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await onAddComment(text.trim());
    setText("");
    setSubmitting(false);
  };

  return (
    <div className="px-4 py-3">
      <span className="text-xs text-foreground/40 font-medium">
        Comments ({comments.length})
      </span>

      {comments.length > 0 && (
        <div className="mt-2 space-y-2">
          {comments.map((comment) => (
            <div key={comment.id} className="text-xs">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium text-foreground/60">
                  {comment.author || "unknown"}
                </span>
                <span className="text-[10px] text-foreground/30">
                  {timeAgo(comment.created_at)}
                </span>
              </div>
              <p className="text-foreground/50 whitespace-pre-wrap">
                {comment.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* add comment */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          placeholder="Add a comment..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className="flex-1 h-7 px-2.5 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/20 focus:bg-accent"
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent text-foreground/30 hover:text-foreground/50 disabled:opacity-30 transition-colors"
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
