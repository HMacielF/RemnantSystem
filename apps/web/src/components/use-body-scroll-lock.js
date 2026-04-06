"use client";

import { useEffect } from "react";

let activeLockCount = 0;
let restoreSnapshot = null;

export default function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked || typeof window === "undefined") return undefined;

    const body = document.body;
    const html = document.documentElement;

    if (activeLockCount === 0) {
      const scrollY = window.scrollY;
      restoreSnapshot = {
        scrollY,
        bodyOverflow: body.style.overflow,
        bodyPosition: body.style.position,
        bodyTop: body.style.top,
        bodyWidth: body.style.width,
        bodyInsetInline: body.style.insetInline,
        htmlOverflow: html.style.overflow,
      };

      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.width = "100%";
      body.style.insetInline = "0";
    }

    activeLockCount += 1;

    return () => {
      activeLockCount = Math.max(0, activeLockCount - 1);
      if (activeLockCount > 0 || !restoreSnapshot) return;

      const snapshot = restoreSnapshot;
      restoreSnapshot = null;

      html.style.overflow = snapshot.htmlOverflow;
      body.style.overflow = snapshot.bodyOverflow;
      body.style.position = snapshot.bodyPosition;
      body.style.top = snapshot.bodyTop;
      body.style.width = snapshot.bodyWidth;
      body.style.insetInline = snapshot.bodyInsetInline;
      window.scrollTo(0, snapshot.scrollY);
    };
  }, [locked]);
}
