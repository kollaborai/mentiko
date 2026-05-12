import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground bg-muted rounded-md px-3 py-2 text-sm focus:outline-none min-h-[80px] resize-y disabled:cursor-not-allowed disabled:opacity-50 w-full",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
