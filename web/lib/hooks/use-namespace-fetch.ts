"use client";

import { useCallback } from "react";
import { useNamespace } from "../ui-context/namespace-context";
import { unwrapApiData } from "../api/api-client";

export function wrapNamespacedResponse(response: Response): Response {
  return new Proxy(response, {
    get(target, prop) {
      if (prop === "json") {
        return async () => unwrapApiData(await target.json());
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Response;
}

export function useNamespaceFetch() {
  const { namespaceId } = useNamespace();

  const fetchWithNamespace = useCallback(
    async (url: string, options?: RequestInit) => {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options?.headers,
          "x-namespace-id": namespaceId,
        },
      });

      return wrapNamespacedResponse(response);
    },
    [namespaceId]
  );

  return { fetchWithNamespace };
}
