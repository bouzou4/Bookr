import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toast host. Follows the OS light/dark setting (theme="system") to match the
 * dashboard's prefers-color-scheme theming, and maps toast surfaces onto the design tokens.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
