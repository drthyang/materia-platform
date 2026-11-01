// @vitest-environment happy-dom
/**
 * The phone's run bar in a DOM. On a phone (RUN_BAR_QUERY) Prefit / Refine /
 * Cancel leave the parameter card for a bar in <body>, with the card's
 * handlers and disabled rule; on a desktop the card keeps them and no bar
 * exists. While a fit runs Cancel takes Refine's place (a double tap on
 * Refine does not cancel it); the bar hides with the Copilot open, while a
 * text field has focus, and when the page keeps the panel mounted but hidden.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RefinementParameter } from "@/core/refinement/types";
import { ParameterPanel } from "@/app/ui/ParameterPanel";
import { CANCEL_ARM_MS, CopilotOpenContext, RUN_BAR_QUERY, isTextEntry } from "@/app/ui/RunActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const realMatchMedia = window.matchMedia;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

/** The window as a phone (RUN_BAR_QUERY matches) or a desktop (nothing does). */
function viewport(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === RUN_BAR_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const PARAMS: RefinementParameter[] = [
  { id: "scale", label: "scale", kind: "scale", value: 1, initialValue: 1, fixed: false },
  { id: "a", label: "a", kind: "lattice", value: 3.905, initialValue: 3.905, fixed: true },
] as RefinementParameter[];

interface Handlers { onRefine: () => void; onThorough: () => void; onCancel: () => void }
const handlers = (): Handlers => ({ onRefine: vi.fn(), onThorough: vi.fn(), onCancel: vi.fn() });

function panel(h: Handlers, props: { busy?: boolean; disabled?: boolean; shown?: boolean; thoroughMode?: "prefit" | "escape"; copilot?: boolean; cancel?: boolean } = {}): ReactElement {
  const { cancel = true, copilot = false, busy = false, ...rest } = props;
  return createElement(
    CopilotOpenContext.Provider,
    { value: copilot },
    createElement(ParameterPanel, {
      params: PARAMS,
      onChange: () => {},
      onReset: () => {},
      result: null,
      busy,
      onRefine: h.onRefine,
      onThorough: h.onThorough,
      ...(cancel ? { onCancel: h.onCancel } : {}),
      ...rest,
    }),
  );
}

function mount(el: ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
const rerender = (el: ReactElement): void => act(() => root!.render(el));

const buttonIn = (scope: ParentNode, text: string): HTMLButtonElement | undefined => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const bar = (): HTMLElement | null => document.querySelector<HTMLElement>(".wb-run-bar");
const click = (b: HTMLButtonElement | undefined): void => {
  expect(b).toBeDefined();
  act(() => b!.click());
};

describe("the run bar", () => {
  it("is absent on a desktop, where the card keeps Prefit and Refine", () => {
    viewport(false);
    const h = handlers();
    const card = mount(panel(h));
    expect(bar()).toBeNull();
    click(buttonIn(card, "Refine"));
    expect(h.onRefine).toHaveBeenCalledTimes(1);
    expect(buttonIn(card, "Prefit ↻")).toBeDefined();
  });

  it("on a phone holds the run actions, outside the card, with the card's handlers", () => {
    viewport(true);
    const h = handlers();
    const card = mount(panel(h));
    const b = bar();
    expect(b).not.toBeNull();
    expect(b!.hidden).toBe(false);
    expect(card.contains(b)).toBe(false);
    expect(b!.getAttribute("role")).toBe("group");
    expect(b!.getAttribute("aria-label")).toBe("Refinement");
    // One Refine in the document: the card's left for the bar.
    expect(buttonIn(card, "Refine")).toBeUndefined();
    expect(buttonIn(card, "Prefit ↻")).toBeUndefined();
    expect([...document.querySelectorAll("button")].filter((x) => x.textContent?.trim() === "Refine")).toHaveLength(1);
    // The card's other controls stay where they were.
    expect(buttonIn(card, "Reset")).toBeDefined();
    click(buttonIn(b!, "Refine"));
    click(buttonIn(b!, "Prefit ↻"));
    expect(h.onRefine).toHaveBeenCalledTimes(1);
    expect(h.onThorough).toHaveBeenCalledTimes(1);
  });

  it("names the multi-start as the card does (Escape min after a fit)", () => {
    viewport(true);
    mount(panel(handlers(), { thoroughMode: "escape" }));
    const escape = buttonIn(bar()!, "Escape min ↻");
    expect(escape?.title).toMatch(/^Escape a local minimum/);
  });

  it("takes the card's disabled rule", () => {
    viewport(true);
    mount(panel(handlers(), { disabled: true }));
    expect(buttonIn(bar()!, "Refine")!.disabled).toBe(true);
    expect(buttonIn(bar()!, "Prefit ↻")!.disabled).toBe(true);
  });

  it("puts Cancel in Refine's place while a fit runs, with its state", () => {
    viewport(true);
    const h = handlers();
    mount(panel(h, { busy: true }));
    const b = bar()!;
    expect(buttonIn(b, "Refine")).toBeUndefined();
    expect(b.querySelector("[role=status]")?.textContent).toBe("Refining…");
    click(buttonIn(b, "Cancel"));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    // Every button in it is 44 px tall at least.
    for (const x of b.querySelectorAll("button")) expect(parseFloat(x.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it("ignores a Cancel tap that is a double tap's second half on Refine", () => {
    viewport(true);
    const h = handlers();
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mount(panel(h));
    click(buttonIn(bar()!, "Refine"));
    rerender(panel(h, { busy: true }));
    now += CANCEL_ARM_MS - 100;
    click(buttonIn(bar()!, "Cancel"));
    expect(h.onCancel).not.toHaveBeenCalled();
    now += 200;
    click(buttonIn(bar()!, "Cancel"));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it("without a cancel (single crystal) shows Refine as running, disabled", () => {
    viewport(true);
    mount(panel(handlers(), { busy: true, cancel: false }));
    const b = bar()!;
    expect(buttonIn(b, "Cancel")).toBeUndefined();
    const refine = [...b.querySelectorAll("button")].find((x) => x.textContent === "Refining…");
    expect(refine?.disabled).toBe(true);
  });

  it("returns keyboard focus to the button in Refine's place", () => {
    viewport(true);
    const h = handlers();
    mount(panel(h));
    const refine = buttonIn(bar()!, "Refine")!;
    act(() => refine.focus());
    rerender(panel(h, { busy: true }));
    expect(document.activeElement?.textContent).toBe("Cancel");
    rerender(panel(h));
    expect(document.activeElement?.textContent).toBe("Refine");
  });

  it("hides while the Copilot is open", () => {
    viewport(true);
    const h = handlers();
    mount(panel(h, { copilot: true }));
    expect(bar()!.hidden).toBe(true);
    rerender(panel(h));
    expect(bar()!.hidden).toBe(false);
  });

  it("hides while a text field has focus (the on-screen keyboard), not a checkbox", () => {
    viewport(true);
    const card = mount(panel(handlers()));
    const field = document.createElement("input");
    field.type = "number";
    card.appendChild(field);
    act(() => field.focus());
    expect(bar()!.hidden).toBe(true);
    const box = document.createElement("input");
    box.type = "checkbox";
    card.appendChild(box);
    act(() => box.focus());
    expect(bar()!.hidden).toBe(false);
  });

  it("is not shown for a panel its page keeps mounted but hidden", () => {
    viewport(true);
    const h = handlers();
    mount(panel(h, { shown: false }));
    expect(bar()).toBeNull();
    rerender(panel(h));
    expect(bar()).not.toBeNull();
  });
});

describe("isTextEntry", () => {
  it("counts the fields a keyboard or picker opens for", () => {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, type?: string): HTMLElementTagNameMap[K] => {
      const el = document.createElement(tag);
      if (type) (el as HTMLInputElement).type = type;
      return el;
    };
    expect(isTextEntry(make("input"))).toBe(true);
    expect(isTextEntry(make("input", "number"))).toBe(true);
    expect(isTextEntry(make("textarea"))).toBe(true);
    expect(isTextEntry(make("select"))).toBe(true);
    expect(isTextEntry(make("input", "checkbox"))).toBe(false);
    expect(isTextEntry(make("button"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
