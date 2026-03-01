"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import type { OutputEnvelope, Session } from "../../lib/types";
import { makeA2AChatModelAdapter } from "./a2aChatModelAdapter";

export function A2AChatRuntime(props: {
  session: Session;
  threadId: string;
  onFinalEnvelope?: (env: OutputEnvelope | null) => void;
  historyAdapter: any;
  children: React.ReactNode;
}) {
  const model = useMemo(
    () =>
      makeA2AChatModelAdapter({
        session: props.session,
        threadId: props.threadId,
        onFinalEnvelope: props.onFinalEnvelope,
      }),
    [props.session, props.threadId, props.onFinalEnvelope],
  );

  const runtime = useLocalRuntime(model, {
    adapters: { history: props.historyAdapter },
  } as any);

  return <AssistantRuntimeProvider runtime={runtime}>{props.children}</AssistantRuntimeProvider>;
}

