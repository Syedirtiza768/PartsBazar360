import type { ReactNode } from "react";
import { blogLinks } from "@repo/ui/blog-links";

function renderInline(line: string) {
  const content: ReactNode[] = [];
  let offset = 0;

  for (const link of blogLinks(line)) {
    content.push(
      line.slice(offset, link.start),
      <a
        key={link.start}
        href={link.href}
        className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
      >
        {link.label}
      </a>,
    );
    offset = link.end;
  }

  content.push(line.slice(offset));
  return content;
}

function renderLine(line: string, index: number) {
  if (!line.trim())
    return <div key={index} className="h-3" aria-hidden="true" />;
  if (line.startsWith("### "))
    return (
      <h3 key={index} className="mt-6 text-lg font-bold text-slate-950">
        {renderInline(line.slice(4))}
      </h3>
    );
  if (line.startsWith("## "))
    return (
      <h2 key={index} className="mt-8 text-xl font-bold text-slate-950">
        {renderInline(line.slice(3))}
      </h2>
    );
  if (/^[-*] /.test(line))
    return (
      <li key={index} className="ml-5 list-disc pl-1">
        {renderInline(line.slice(2))}
      </li>
    );
  return (
    <p key={index} className="leading-7 text-graphite-700">
      {renderInline(line)}
    </p>
  );
}
export function BlogBody({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-base">
      {content.split(/\r?\n/).map(renderLine)}
    </div>
  );
}
