import { wrapNamespacedResponse } from "./use-namespace-fetch";

describe("wrapNamespacedResponse", () => {
  it("preserves native Response getters while unwrapping JSON envelopes", async () => {
    class FakeResponse {
      #state = { ok: true, status: 201 };

      headers = {
        get(name: string) {
          return name.toLowerCase() === "content-type" ? "application/json" : null;
        },
      };

      get ok() {
        return this.#state.ok;
      }

      get status() {
        return this.#state.status;
      }

      async json() {
        return {
          success: true,
          data: { workspaces: [{ id: "mentiko", name: "Mentiko" }] },
          requestId: "req_test",
        };
      }
    }

    const response = new FakeResponse() as unknown as Response;
    const wrapped = wrapNamespacedResponse(response);
    const data = await wrapped.json() as {
      workspaces: Array<{ id: string; name: string }>;
    };

    expect(wrapped.ok).toBe(true);
    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get("content-type")).toBe("application/json");
    expect(data.workspaces).toEqual([{ id: "mentiko", name: "Mentiko" }]);
  });

  it("reproduces the native getter failure mode the wrapper is protecting against", () => {
    class FakeResponse {
      #state = { ok: true };

      get ok() {
        return this.#state.ok;
      }
    }

    const response = new FakeResponse();
    const brokenProxy = new Proxy(response, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(() => brokenProxy.ok).toThrow(/private member/i);
  });
});
