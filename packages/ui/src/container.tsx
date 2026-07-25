import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * The platform's content ladder. Before this, six different max-widths were in
 * play (1440px, 7xl, 6xl, 5xl, 3xl, 2xl) with three different gutter recipes,
 * so the header, the search results and the cart all lined up differently on
 * the same screen.
 *
 *  · prose   — long-form copy, capped by character count, not pixels
 *  · narrow  — single-column forms and confirmations (auth, checkout success)
 *  · content — reading-dense pages: cart, checkout, settings, detail pages
 *  · wide    — marketplace grids, dashboards, tables; matches the app chrome
 *  · full    — full-bleed sections that supply their own inner container
 */
export type ContainerSize = "prose" | "narrow" | "content" | "wide" | "full";

const SIZES: Record<ContainerSize, string> = {
  prose: "max-w-prose",
  narrow: "max-w-3xl",
  content: "max-w-content",
  wide: "max-w-wide",
  full: "max-w-none",
};

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  size?: ContainerSize;
  /** Renders as this element — use `main`, `section`, `header` as appropriate. */
  as?: ElementType;
  /** Drop the horizontal gutter (for nested containers). */
  bare?: boolean;
  children: ReactNode;
}

export function Container({
  size = "content",
  as: Tag = "div",
  bare = false,
  className,
  children,
  ...rest
}: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full", SIZES[size], !bare && "gutter", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Vertical rhythm for a page body. Kept separate from Container so a page can
 * change its width without also changing its top/bottom spacing.
 */
export function PageBody({
  size = "content",
  className,
  children,
  ...rest
}: ContainerProps) {
  return (
    <Container size={size} className={cn("py-6 sm:py-8 lg:py-10", className)} {...rest}>
      {children}
    </Container>
  );
}
