"use client";

import { useId, useRef, useState } from "react";
import { blogLinks, internalBlogHref } from "@repo/ui/blog-links";
import { Button } from "@repo/ui/button";
import { Input, Textarea } from "@repo/ui/field";

type LinkSelection = { start: number; end: number; originalLabel?: string };

export function BlogContentEditor({
  content: storedContent,
  onChange,
  disabled,
}: {
  content: string;
  onChange: (content: string) => void;
  disabled: boolean;
}) {
  const titleId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<LinkSelection | null>(null);
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<{ label?: string; destination?: string }>(
    {},
  );
  const content = storedContent.replace(/\r\n?/g, "\n");
  const originalLabel = selection?.originalLabel;

  function openLinkEditor() {
    const editor = textarea.current;
    if (!editor) return;

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const existing = [...blogLinks(content)].find(
      (link) => link.start <= start && link.end >= end && start < link.end,
    );
    const selectedText = content.slice(start, end);
    const linkText = selectedText.trim();
    const textStart = linkText ? start + selectedText.indexOf(linkText) : start;
    setSelection(
      existing
        ? {
            start: existing.start,
            end: existing.end,
            originalLabel: existing.label,
          }
        : {
            start: textStart,
            end: linkText ? textStart + linkText.length : end,
          },
    );
    setLabel(existing?.label ?? linkText);
    setDestination(existing?.href ?? "");
    setError({});
    dialog.current?.showModal();
  }

  function replaceSelection(replacement: string, keepSelected = false) {
    if (!selection) return;
    const { start, end } = selection;
    onChange(content.slice(0, start) + replacement + content.slice(end));
    dialog.current?.close();
    requestAnimationFrame(() => {
      const editor = textarea.current;
      const caret = start + replacement.length;
      editor?.focus();
      editor?.setSelectionRange(keepSelected ? start : caret, caret);
    });
  }

  function saveLink() {
    const linkText = label.trim();
    const href = internalBlogHref(destination);
    if (!linkText || /[[\]\r\n]/.test(linkText)) {
      setError({
        label: "Enter one line of link text without square brackets.",
      });
      return;
    }
    if (!href) {
      setError({
        destination:
          "Enter a PartsBazar360 URL or a path starting with /, such as /buyer/search/.",
      });
      return;
    }
    replaceSelection(`[${linkText}](${href})`, true);
  }

  return (
    <div className="space-y-2">
      <Textarea
        ref={textarea}
        label="Content"
        required
        value={content}
        onChange={(event) => onChange(event.target.value)}
        hint="Select words to link, or place the cursor inside an existing link to edit or remove it."
        className="[&_textarea]:min-h-[260px]"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={openLinkEditor}
      >
        Add or edit internal link
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl backdrop:bg-slate-950/50 sm:p-6"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
            saveLink();
          }
        }}
      >
        <h3 id={titleId} className="text-lg font-bold text-slate-950">
          {originalLabel ? "Edit internal link" : "Add internal link"}
        </h3>
        <Input
          label="Link text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          error={error.label}
        />
        <Input
          label="Destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="/buyer/search/"
          error={error.destination}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={saveLink}>
            {originalLabel ? "Update link" : "Insert link"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </Button>
          {originalLabel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => replaceSelection(originalLabel)}
            >
              Remove link
            </Button>
          )}
        </div>
      </dialog>
    </div>
  );
}
