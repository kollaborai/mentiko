// analytics hooks for common patterns

"use client";

import { useCallback, useRef } from "react";
import { analytics, useUserFlow } from "@/lib/system/analytics";

// track events with loading states
export function useTrackEvent() {
  return useCallback((name: string, params?: Record<string, string | number | boolean>) => {
    analytics.track({ name, params });
  }, []);
}

// track clicks with custom data
export function useTrackClick(eventName: string) {
  return useCallback((data?: Record<string, string | number | boolean>) => {
    analytics.track({
      name: eventName,
      params: data,
    });
  }, [eventName]);
}

// track form submissions
export function useTrackForm(formName: string) {
  const startRef = useRef<number | undefined>(undefined);

  const start = useCallback(() => {
    startRef.current = performance.now();
    analytics.track({
      name: "form_start",
      params: { form_name: formName },
    });
  }, [formName]);

  const submit = useCallback((success: boolean, errors?: string[]) => {
    const duration = startRef.current ? performance.now() - startRef.current : 0;

    analytics.track({
      name: "form_submit",
      params: {
        form_name: formName,
        success,
        duration_ms: Math.round(duration),
        error_count: errors?.length || 0,
      },
    });
  }, [formName]);

  return { start, submit };
}

// track feature usage
export function useTrackFeature(featureName: string) {
  return useCallback((action: string, metadata?: Record<string, string | number | boolean>) => {
    analytics.track({
      name: "feature_used",
      params: {
        feature: featureName,
        action,
        ...metadata,
      },
    });
  }, [featureName]);
}

// track errors
export function useTrackError() {
  return useCallback((error: Error, context?: Record<string, string>) => {
    analytics.track({
      name: "error",
      params: {
        message: error.message,
        name: error.name,
        stack: error.stack?.slice(0, 200), // truncate long stacks
        ...context,
      },
    });
  }, []);
}

// track search queries
export function useTrackSearch(searchType: string) {
  return useCallback((query: string, resultsCount?: number) => {
    analytics.track({
      name: "search",
      params: {
        type: searchType,
        query_length: query.length,
        results_count: resultsCount ?? 0,
      },
    });
  }, [searchType]);
}

// track engagement time
export function useTrackEngagement(entityType: string, entityId: string) {
  const startTimeRef = useRef<number | undefined>(undefined);

  const start = useCallback(() => {
    startTimeRef.current = performance.now();
  }, []);

  const end = useCallback(() => {
    if (!startTimeRef.current) return 0;
    const duration = performance.now() - startTimeRef.current;

    analytics.track({
      name: "engagement",
      params: {
        entity_type: entityType,
        entity_id: entityId,
        duration_ms: Math.round(duration),
      },
    });

    return duration;
  }, [entityType, entityId]);

  return { start, end };
}

// track modal/dialog opens
export function useTrackModal(modalName: string) {
  return useCallback((action: "open" | "close" | "submit" | "cancel") => {
    analytics.track({
      name: "modal_interaction",
      params: {
        modal: modalName,
        action,
      },
    });
  }, [modalName]);
}

// chain-specific tracking
export function useTrackChain() {
  const runFlow = useUserFlow("chain_run", 5); // 5 step flow

  return {
    // view chain
    view: useCallback((chainId: string, chainName: string) => {
      analytics.track({
        name: "chain_view",
        params: { chain_id: chainId, chain_name: chainName },
      });
    }, []),

    // create chain
    create: useCallback((templateId?: string) => {
      analytics.track({
        name: "chain_create",
        params: { template_used: templateId ?? "none" },
      });
    }, []),

    // save chain
    save: useCallback((chainId: string, hasChanges: boolean) => {
      analytics.track({
        name: "chain_save",
        params: {
          chain_id: chainId,
          has_changes: hasChanges,
        },
      });
    }, []),

    // delete chain
    delete: useCallback((chainId: string) => {
      analytics.track({
        name: "chain_delete",
        params: { chain_id: chainId },
      });
    }, []),

    // run chain flow steps
    runStart: useCallback((chainId: string) => {
      runFlow.trackStep("run_start", 1);
      analytics.track({ name: "chain_run_start", params: { chain_id: chainId } });
    }, [runFlow]),

    runConfig: useCallback(() => runFlow.trackStep("configure", 2), [runFlow]),
    runValidation: useCallback((valid: boolean) => {
      runFlow.trackStep("validation", 3);
      analytics.track({
        name: "chain_validation",
        params: { valid },
      });
    }, [runFlow]),
    runExecute: useCallback(() => runFlow.trackStep("execute", 4), [runFlow]),
    runComplete: useCallback((success: boolean) => {
      runFlow.trackStep("complete", 5);
      analytics.track({
        name: "chain_run_complete",
        params: { success },
      });
    }, [runFlow]),
  };
}

// agent session tracking
export function useTrackAgent() {
  return {
    start: useCallback((agentType: string) => {
      analytics.track({
        name: "agent_session_start",
        params: { agent_type: agentType },
      });
    }, []),

    message: useCallback((session: string, isUser: boolean) => {
      analytics.track({
        name: "agent_message",
        params: {
          session_id: session,
          from: isUser ? "user" : "agent",
        },
      });
    }, []),

    end: useCallback((session: string, messageCount: number, duration: number) => {
      analytics.track({
        name: "agent_session_end",
        params: {
          session_id: session,
          message_count: messageCount,
          duration_ms: duration,
        },
      });
    }, []),
  };
}

// template usage tracking
export function useTrackTemplate() {
  return useCallback((templateId: string, categoryName: string) => {
    analytics.track({
      name: "template_used",
      params: {
        template_id: templateId,
        category: categoryName,
      },
    });
  }, []);
}
