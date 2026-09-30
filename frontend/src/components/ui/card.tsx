import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <article
      ref={ref}
      className={cn(
        "rounded-xl border border-[#e0e0d7] bg-[#fffefa] text-[#202b26] shadow-sm",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export { Card };
