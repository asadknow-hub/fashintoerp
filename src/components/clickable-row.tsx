"use client";

import { useRouter } from "next/navigation";

// A table row that opens a page when it is clicked anywhere, except on the
// buttons, links and boxes inside it (those keep doing their own thing), and
// not while text in it is being selected.
export function ClickableRow({
  href,
  className = "",
  children,
  ...rest
}: { href: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  const router = useRouter();
  return (
    <tr
      {...rest}
      className={className + " cursor-pointer"}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a, button, input, select, textarea, label, [data-modal]")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
