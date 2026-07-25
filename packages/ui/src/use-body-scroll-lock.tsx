"use client";

import { useEffect } from "react";

/**
 * Locks background scrolling while an overlay is open.
 *
 * `overflow: hidden` on <body> alone is not enough on iOS Safari, which keeps
 * scrolling the document behind the overlay ("scroll chaining") and then
 * restores to the wrong position on close. The reliable fix is to take the body
 * out of flow at its current offset and put it back afterwards.
 *
 * The scrollbar-width compensation stops desktop layouts from jumping sideways
 * by the width of the scrollbar the moment a dialog opens.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const { body, documentElement: html } = document;
    const scrollY = window.scrollY;
    const scrollbar = window.innerWidth - html.clientWidth;

    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflowY: body.style.overflowY,
      paddingRight: body.style.paddingRight,
      scrollBehavior: html.style.scrollBehavior,
    };

    // `scroll-behavior: smooth` on <html> would animate the restore scroll.
    html.style.scrollBehavior = "auto";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflowY = "scroll"; // keep the gutter so nothing reflows
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflowY = previous.overflowY;
      body.style.paddingRight = previous.paddingRight;
      window.scrollTo(0, scrollY);
      html.style.scrollBehavior = previous.scrollBehavior;
    };
  }, [locked]);
}
