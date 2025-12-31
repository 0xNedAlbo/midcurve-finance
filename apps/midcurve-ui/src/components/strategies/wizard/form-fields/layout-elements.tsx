"use client";

import type { LayoutElement } from "@midcurve/shared";

interface SectionHeadingProps {
  layout: LayoutElement;
}

/**
 * Section heading for organizing form fields
 */
export function SectionHeading({ layout }: SectionHeadingProps) {
  return (
    <div className="pt-4 first:pt-0">
      {layout.title && (
        <h4 className="text-sm font-semibold text-slate-200 mb-1">
          {layout.title}
        </h4>
      )}
      {layout.description && (
        <p className="text-xs text-slate-400">{layout.description}</p>
      )}
    </div>
  );
}

/**
 * Visual separator between form sections
 */
export function Separator() {
  return <hr className="border-slate-700/50 my-4" />;
}
