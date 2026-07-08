import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Dark-only app, so pin the theme instead of pulling in next-themes.
// Colors come from the shadcn tokens so toasts match the terminal surfaces.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--success)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--destructive)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "bevel-lg rounded-lg",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
