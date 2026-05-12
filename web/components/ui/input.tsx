import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "placeholder:text-muted-foreground bg-muted rounded-md px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 w-full",
        className
      )}
      {...props}
    />
  )
}

export { Input }
