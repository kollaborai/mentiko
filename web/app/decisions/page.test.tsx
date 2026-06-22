/**
 * @jest-environment node
 */

const redirect = jest.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});

jest.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import DecisionsPage from "./page";

describe("/decisions", () => {
  it("redirects to task decisions because decisions are task rows now", () => {
    expect(() => DecisionsPage()).toThrow("redirect:/tasks?type=decision");
    expect(redirect).toHaveBeenCalledWith("/tasks?type=decision");
  });
});
