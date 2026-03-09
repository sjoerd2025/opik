import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Loader2,
  Play,
  Square,
  Info,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { useLocation } from "@tanstack/react-router";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TEXT_AREA_CLASSES } from "@/components/ui/textarea";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import MarkdownPreview from "@/components/shared/MarkdownPreview/MarkdownPreview";
import useOllieStore, { OllieMessage } from "@/store/OllieStore";
import useCopilotRunStreaming from "@/api/copilot/useCopilotRunStreaming";
import useCopilotHistory from "@/api/copilot/useCopilotHistory";
import useCopilotDeleteSession from "@/api/copilot/useCopilotDeleteSession";
import { useChatScroll } from "@/components/pages-shared/traces/TraceDetailsPanel/TraceAIViewer/useChatScroll";
import { LLM_MESSAGE_ROLE } from "@/types/llm";
import { MESSAGE_TYPE } from "@/types/ai-assistant";
import { cn } from "@/lib/utils";
import { derivePageContext } from "@/constants/pageIds";
import OllieContextBar from "./OllieContextBar";

const RUN_HOT_KEYS = ["⌘", "⏎"];

const OllieChatView: React.FC = () => {
  const { toast } = useToast();
  const location = useLocation();
  const {
    messages,
    inputValue,
    isStreaming,
    tableState,
    addMessage,
    updateMessage,
    setInputValue,
    setIsStreaming,
    clearMessages,
  } = useOllieStore();

  const [isStreamingText, setIsStreamingText] = useState(false);
  const [pendingToolCallCount, setPendingToolCallCount] = useState(0);
  const isThinking =
    isStreaming && !isStreamingText && pendingToolCallCount === 0;
  const abortControllerRef = useRef<AbortController>();
  const historyLoadedRef = useRef(false);

  const searchParams = new URLSearchParams(location.search);
  const {
    pageId,
    description: pageDescription,
    params,
  } = derivePageContext(location.pathname, searchParams);
  const runStreaming = useCopilotRunStreaming();
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    isError: isHistoryError,
  } = useCopilotHistory();
  const { mutate: deleteSession, isPending: isDeletingSession } =
    useCopilotDeleteSession();

  const totalContentLength = useMemo(
    () => messages.reduce((acc, msg) => acc + msg.content.length, 0),
    [messages],
  );

  const { scrollContainerRef } = useChatScroll({
    contentLength: totalContentLength,
    isStreaming,
  });

  const predefinedPrompts = useMemo(
    () => [
      "How do I get started with Opik?",
      "What are traces and spans?",
      "How do I evaluate my LLM application?",
      "Tell me about prompt management",
    ],
    [],
  );

  const startStreaming = useCallback(() => {
    abortControllerRef.current = new AbortController();
    setIsStreaming(true);
    return abortControllerRef.current;
  }, [setIsStreaming]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = undefined;
    }
    setIsStreaming(false);
    setIsStreamingText(false);
    setPendingToolCallCount(0);
  }, [setIsStreaming]);

  // Clear Zustand messages on mount to prevent showing stale data
  useEffect(() => {
    clearMessages();
    historyLoadedRef.current = false;
  }, [clearMessages]);

  // Load conversation history when data arrives
  useEffect(() => {
    if (historyData?.content && !historyLoadedRef.current) {
      historyData.content.forEach((msg) => {
        addMessage({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          toolCalls: msg.toolCalls,
        });
      });
      historyLoadedRef.current = true;
    }
  }, [historyData, addMessage]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMessage: OllieMessage = {
        id: `user-${Date.now()}`,
        role: LLM_MESSAGE_ROLE.user,
        content,
      };

      addMessage(userMessage);

      const abortController = startStreaming();

      // Track current in-progress text message with accumulated content
      type TextMessageState = {
        messageId: string;
        accumulatedContent: string;
        finalized: boolean;
      };
      const textMessageState: { current: TextMessageState | null } = {
        current: null,
      };
      // Track tool call messages by tool call id
      const toolCallMessages = new Map<string, string>();

      try {
        const { error } = await runStreaming({
          message: content,
          pageId,
          pageDescription,
          pageParams: params,
          tableState,
          signal: abortController.signal,
          onAddChunk: (data) => {
            if (data.messageType === MESSAGE_TYPE.response) {
              const text = data.content || "";
              const isPartial = data.partial === true;
              const needsNewMessage =
                !textMessageState.current || textMessageState.current.finalized;

              if (isPartial) {
                setIsStreamingText(true);
                if (needsNewMessage) {
                  const messageId = `assistant-${Date.now()}`;
                  textMessageState.current = {
                    messageId,
                    accumulatedContent: text,
                    finalized: false,
                  };
                  const assistantMessage: OllieMessage = {
                    id: messageId,
                    role: LLM_MESSAGE_ROLE.assistant,
                    content: text,
                    isLoading: true,
                  };
                  addMessage(assistantMessage);
                } else {
                  textMessageState.current!.accumulatedContent += text;
                  updateMessage(textMessageState.current!.messageId, {
                    content: textMessageState.current!.accumulatedContent,
                    isLoading: true,
                  });
                }
              } else {
                // Final message (partial: false) - contains complete text
                setIsStreamingText(false);
                if (needsNewMessage) {
                  const messageId = `assistant-${Date.now()}`;
                  textMessageState.current = {
                    messageId,
                    accumulatedContent: text,
                    finalized: true,
                  };
                  const assistantMessage: OllieMessage = {
                    id: messageId,
                    role: LLM_MESSAGE_ROLE.assistant,
                    content: text,
                    isLoading: false,
                  };
                  addMessage(assistantMessage);
                } else {
                  textMessageState.current!.accumulatedContent = text;
                  textMessageState.current!.finalized = true;
                  updateMessage(textMessageState.current!.messageId, {
                    content: text,
                    isLoading: false,
                  });
                }
              }
            } else if (data.messageType === MESSAGE_TYPE.tool_call) {
              const toolCall = data.toolCall!;
              const toolCallId = toolCall.id;

              if (!toolCallMessages.has(toolCallId)) {
                setPendingToolCallCount((prev) => prev + 1);
                // Create new tool call message
                const messageId = `tool-${toolCallId}`;
                toolCallMessages.set(toolCallId, messageId);
                const toolCallMessage: OllieMessage = {
                  id: messageId,
                  role: LLM_MESSAGE_ROLE.assistant,
                  content: "",
                  toolCalls: [
                    {
                      id: toolCallId,
                      name: toolCall.name,
                      display_name: toolCall.display_name,
                      completed: false,
                    },
                  ],
                };
                addMessage(toolCallMessage);
              }
            } else if (data.messageType === MESSAGE_TYPE.tool_complete) {
              const toolResponse = data.toolResponse!;
              const toolCallId = toolResponse.id;

              if (toolCallMessages.has(toolCallId)) {
                setPendingToolCallCount((prev) => Math.max(0, prev - 1));
                // Mark tool as completed
                const messageId = toolCallMessages.get(toolCallId)!;
                updateMessage(messageId, {
                  toolCalls: [
                    {
                      id: toolCallId,
                      name: toolResponse.name,
                      display_name: toolResponse.name,
                      completed: true,
                    },
                  ],
                });
              }
            }
          },
        });

        if (error) {
          throw new Error(error);
        }
      } catch (error) {
        const typedError = error as Error;
        const isStopped = typedError.name === "AbortError";

        if (!isStopped) {
          const errorMessage: OllieMessage = {
            id: `error-${Date.now()}`,
            role: LLM_MESSAGE_ROLE.assistant,
            content: typedError.message,
            isError: true,
          };
          addMessage(errorMessage);

          toast({
            title: "Error",
            variant: "destructive",
            description: typedError.message,
          });
        }
      } finally {
        // Mark current message as complete if still loading
        if (textMessageState.current && !textMessageState.current.finalized) {
          updateMessage(textMessageState.current.messageId, {
            isLoading: false,
          });
        }
        setIsStreamingText(false);
        setPendingToolCallCount(0);
        stopStreaming();
      }
    },
    [
      addMessage,
      updateMessage,
      runStreaming,
      startStreaming,
      stopStreaming,
      toast,
      pageId,
      pageDescription,
      params,
      tableState,
    ],
  );

  const handleButtonClick = useCallback(() => {
    if (isStreaming) {
      stopStreaming();
    } else if (inputValue.trim()) {
      sendMessage(inputValue);
      setInputValue("");
    }
  }, [isStreaming, stopStreaming, inputValue, sendMessage, setInputValue]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        handleButtonClick();
      }
    },
    [handleButtonClick],
  );

  const handlePredefinedPrompt = useCallback(
    (prompt: string) => {
      sendMessage(prompt);
    },
    [sendMessage],
  );

  const handleClearConversation = useCallback(() => {
    deleteSession(undefined, {
      onSuccess: () => {
        clearMessages();
        toast({
          title: "Conversation cleared",
          description: "Your conversation history has been deleted.",
        });
      },
      onError: (error) => {
        toast({
          title: "Error",
          variant: "destructive",
          description: `Failed to clear conversation: ${error.message}`,
        });
      },
    });
  }, [deleteSession, clearMessages, toast]);

  const renderEmptyState = () => {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 px-4 py-2">
        <div className="comet-title-m text-center text-foreground">
          Chat with OllieAI
        </div>
        <div className="comet-body-s mb-4 text-center text-muted-slate">
          Your AI assistant for Opik. Ask questions about traces, evaluations,
          prompts, and more.
        </div>
        <div className="flex w-full flex-col gap-2">
          {predefinedPrompts.map((prompt) => (
            <Button
              key={prompt}
              variant="outline"
              className="h-auto justify-start whitespace-normal py-2 text-left"
              onClick={() => handlePredefinedPrompt(prompt)}
              aria-label={`Use prompt: ${prompt}`}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  const renderMessage = (message: OllieMessage) => {
    const isUser = message.role === LLM_MESSAGE_ROLE.user;
    const isToolCall = message.toolCalls && message.toolCalls.length > 0;
    const noContent = message.content === "";

    // Tool call messages have their own rendering
    if (isToolCall) {
      return (
        <div key={message.id} className="mb-2 flex justify-start">
          <div className="relative min-w-[20%] max-w-[90%] rounded-lg bg-muted/30 px-3 py-2">
            <div className="flex flex-col gap-1.5">
              {message.toolCalls!.map((toolCall) => (
                <div
                  key={toolCall.id}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  {toolCall.completed ? (
                    <CheckCircle2 className="size-3 text-green-600" />
                  ) : (
                    <Loader2 className="size-3 animate-spin" />
                  )}
                  <span className="comet-body-xs">{toolCall.display_name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        key={message.id}
        className={cn("mb-2 flex", isUser ? "justify-end" : "justify-start")}
      >
        <div
          className={cn(
            "relative min-w-[20%] max-w-[90%] px-3 py-2 rounded-lg",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted",
            message.isError && "bg-destructive/10 border border-destructive",
            noContent && "w-4/5",
          )}
        >
          {message.isError && (
            <div className="mb-1 flex items-center gap-1 text-destructive">
              <AlertCircle className="size-3" />
              <span className="comet-body-s-accented">Error</span>
            </div>
          )}
          {noContent ? (
            <div className="flex w-full flex-wrap gap-2 overflow-hidden">
              <Skeleton className="inline-block h-2 w-1/4" />
              <Skeleton className="inline-block h-2 w-2/3" />
              <Skeleton className="inline-block h-2 w-3/4" />
              <Skeleton className="inline-block h-2 w-1/4" />
            </div>
          ) : (
            <MarkdownPreview
              className={cn(
                "text-sm",
                message.isError && "text-destructive",
                isUser && "text-primary-foreground",
              )}
            >
              {message.content}
            </MarkdownPreview>
          )}
        </div>
      </div>
    );
  };

  const noMessages = messages.length === 0;
  const isDisabledButton = !inputValue && !isStreaming;
  const showEmptyState = noMessages && !isLoadingHistory && !isHistoryError;
  const showLoadingState = isLoadingHistory;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4" ref={scrollContainerRef}>
        {showLoadingState ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-3 px-4 py-2">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <div className="comet-body-s text-muted-slate">
              Loading conversation...
            </div>
          </div>
        ) : showEmptyState ? (
          renderEmptyState()
        ) : (
          <div className="flex w-full flex-col gap-2 py-4">
            {messages.map(renderMessage)}
            {isThinking && (
              <div className="mb-2 flex justify-start">
                <div className="relative min-w-[20%] max-w-[90%] rounded-lg bg-muted px-3 py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    <span className="comet-body-xs">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context bar */}
      <OllieContextBar
        pageId={pageId}
        pageDescription={pageDescription}
        params={params}
        tableState={tableState}
      />

      {/* Input area */}
      <div className="bg-background px-4 py-3">
        <div className="relative">
          <TextareaAutosize
            placeholder="Ask me anything about Opik..."
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(TEXT_AREA_CLASSES, "min-h-12 leading-none pr-10")}
            minRows={3}
            maxRows={6}
          />
          <TooltipWrapper
            content={isStreaming ? "Stop" : "Send message"}
            hotkeys={isDisabledButton ? undefined : RUN_HOT_KEYS}
          >
            <Button
              size="icon-sm"
              className="absolute bottom-2 right-2"
              onClick={handleButtonClick}
              disabled={isDisabledButton}
            >
              {isStreaming ? <Square /> : <Play />}
            </Button>
          </TooltipWrapper>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="comet-body-xs relative pl-4 text-light-slate">
            <Info className="absolute left-0 top-0.5 size-3 shrink-0" />
            OllieAI is a prototype. Responses may not always be accurate.
          </div>
          {!noMessages && (
            <TooltipWrapper content="Clear conversation">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={handleClearConversation}
                disabled={isDeletingSession || isStreaming}
              >
                <Trash2 className="size-3" />
              </Button>
            </TooltipWrapper>
          )}
        </div>
      </div>
    </div>
  );
};

export default OllieChatView;
