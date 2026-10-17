import { StrictMode, useRef } from "react";
import { act, render } from "@testing-library/react";
import { usePillNavInsets } from "../use-pill-nav-insets";

type Layout = Parameters<typeof usePillNavInsets>[1];
const edges = ["top", "right", "bottom", "left"] as const;
const originalResizeObserver = global.ResizeObserver;
const observers = new Set<ResizeObserverMock>();
let width = 52;
let height = 44;
let scrollHeight = 44;
let viewportHeight = 768;
const originalViewportHeight = window.innerHeight;

class ResizeObserverMock {
  constructor(private callback: ResizeObserverCallback) {}
  observe = jest.fn(() => observers.add(this));
  unobserve = jest.fn();
  disconnect = jest.fn(() => observers.delete(this));
  notify() { this.callback([], this as unknown as ResizeObserver); }
}

function Harness(props: Layout) {
  const ref = useRef<HTMLDivElement>(null);
  const bounds = usePillNavInsets(ref, props);
  return (
    <div
      ref={ref}
      data-pill-nav=""
      data-max-height={bounds?.maxHeight}
      data-min-center={bounds?.minCenter}
      data-max-center={bounds?.maxCenter}
    />
  );
}

function insets() {
  return Object.fromEntries(edges.map(edge => [
    edge,
    document.documentElement.style.getPropertyValue(`--mentiko-pill-nav-inset-${edge}`),
  ]));
}

function resizeNav() {
  act(() => { for (const observer of observers) observer.notify(); });
}

beforeEach(() => {
  width = 52;
  height = 44;
  scrollHeight = 44;
  viewportHeight = 768;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewportHeight });
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  jest.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => width);
  jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
  jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalViewportHeight });
  global.ResizeObserver = originalResizeObserver;
  observers.clear();
});

it.each(edges)("reserves only the %s edge using the measured bar thickness plus clearance", edge => {
  render(<Harness edge={edge} scale={1} suspended={false} />);

  expect(insets()).toEqual({
    top: "0px", right: "0px", bottom: "0px", left: "0px",
    [edge]: edge === "left" || edge === "right" ? "64px" : "56px",
  });
});

it("updates the footprint when the user's scale changes", () => {
  const { rerender } = render(<Harness edge="left" scale={1} suspended={false} />);
  rerender(<Harness edge="left" scale={1.25} suspended={false} />);
  expect(insets().left).toBe("77px");
});

it("follows content and window resizes while docked", () => {
  render(<Harness edge="bottom" scale={1.25} suspended={false} />);
  height = 61;
  resizeNav();
  expect(insets().bottom).toBe("89px");

  height = 80;
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(insets().bottom).toBe("112px");
});

it("caps a tall side rail and clamps its center inside the viewport", () => {
  scrollHeight = 800;
  height = 800;
  viewportHeight = 600;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewportHeight });
  const { container } = render(<Harness edge="left" scale={1.25} suspended={false} />);
  const nav = container.firstChild as HTMLElement;

  expect(Number(nav.dataset.maxHeight)).toBeCloseTo(460.8);
  expect(Number(nav.dataset.minCenter)).toBe(300);
  expect(Number(nav.dataset.maxCenter)).toBe(300);

  viewportHeight = 900;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewportHeight });
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(Number(nav.dataset.maxHeight)).toBeCloseTo(700.8);
  expect(Number(nav.dataset.minCenter)).toBe(450);
  expect(Number(nav.dataset.maxCenter)).toBe(450);
});

it("holds the old footprint through dragging and commits the new edge on release", () => {
  const { rerender, container } = render(<Harness edge="left" scale={1} suspended={false} />);
  const nav = container.firstChild;
  const before = insets();

  // A side bar becomes horizontal during a drag. Neither that size nor the
  // hovered edge may move the page until the dock is committed.
  width = 720;
  height = 44;
  rerender(<Harness edge="bottom" scale={1.25} suspended />);
  resizeNav();
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(insets()).toEqual(before);

  rerender(<Harness edge="bottom" scale={1.25} suspended={false} />);
  expect(insets()).toEqual({ top: "0px", right: "0px", bottom: "67px", left: "0px" });
  expect(container.firstChild).toBe(nav);
});

it("keeps the original edge after a cancelled drag or summon", () => {
  const { rerender } = render(<Harness edge="right" scale={1} suspended={false} />);
  const before = insets();
  rerender(<Harness edge="right" scale={1} suspended />);
  width = 720;
  resizeNav();
  expect(insets()).toEqual(before);
  width = 52;
  rerender(<Harness edge="right" scale={1} suspended={false} />);
  expect(insets()).toEqual(before);
});

it("does not reserve a gap for a hidden bar", () => {
  height = 0;
  render(<Harness edge="top" scale={1} suspended={false} />);
  expect(insets()).toEqual({ top: "0px", right: "0px", bottom: "0px", left: "0px" });
});

it("releases all space and observers when the nav unmounts", () => {
  const { unmount } = render(<StrictMode><Harness edge="top" scale={1} suspended={false} /></StrictMode>);
  expect(insets().top).toBe("56px");
  unmount();
  expect(observers.size).toBe(0);
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(insets()).toEqual({ top: "", right: "", bottom: "", left: "" });
});
