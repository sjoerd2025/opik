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
} from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TEXT_AREA_CLASSES } from "@/components/ui/textarea";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import MarkdownPreview from "@/components/shared/MarkdownPreview/MarkdownPreview";
import useOllieStore, { OllieMessage } from "@/store/OllieStore";
import useOllieStreaming from "@/api/ollie/useOllieStreaming";
import { useChatScroll } from "@/components/pages-shared/traces/TraceDetailsPanel/TraceAIViewer/useChatScroll";
import useAppStore from "@/store/AppStore";
import { LLM_MESSAGE_ROLE } from "@/types/llm";
import { LLMAnthropicConfigsType } from "@/types/providers";
import { cn } from "@/lib/utils";

const RUN_HOT_KEYS = ["⌘", "⏎"];

const OllieChatView: React.FC = () => {
  const { toast } = useToast();
  const { activeWorkspaceName: workspaceName } = useAppStore();
  const {
    messages,
    inputValue,
    isStreaming,
    addMessage,
    updateMessage,
    setInputValue,
    setIsStreaming,
  } = useOllieStore();

  const [isThinking, setIsThinking] = useState(false);
  const abortControllerRef = useRef<AbortController>();

  const runStreaming = useOllieStreaming({ workspaceName });

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
    setIsThinking(false);
  }, [setIsStreaming]);

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
      setIsThinking(true);

      const abortController = startStreaming();

      const assistantMessageId = `assistant-${Date.now()}`;
      const toolCallMessageId = `tool-call-${Date.now()}`;
      let hasStartedStreaming = false;

      try {
        // Simulate a "documentation search" tool call
        const toolCallMessage: OllieMessage = {
          id: toolCallMessageId,
          role: LLM_MESSAGE_ROLE.assistant,
          content: "",
          toolCalls: [
            {
              id: `tool-${Date.now()}`,
              name: "documentation_search",
              display_name: "Searching Opik documentation",
              completed: false,
            },
          ],
        };
        addMessage(toolCallMessage);

        // Simulate tool execution delay
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Mark tool as completed
        updateMessage(toolCallMessageId, {
          toolCalls: [
            {
              id: toolCallMessage.toolCalls![0].id,
              name: "documentation_search",
              display_name: "Searching Opik documentation",
              completed: true,
            },
          ],
        });

        const conversationHistory = messages
          .filter((m) => !m.isError && !m.toolCalls)
          .map((m) => ({
            role: m.role,
            content: m.content,
          }));

        const { providerError, opikError, pythonProxyError } =
          await runStreaming({
            userMessage: content,
            conversationHistory,
            configs: {
              temperature: 0.7,
              maxCompletionTokens: 2000,
            } as LLMAnthropicConfigsType,
            onAddChunk: (accumulatedValue) => {
              setIsThinking(false);

              if (!hasStartedStreaming) {
                hasStartedStreaming = true;
                const assistantMessage: OllieMessage = {
                  id: assistantMessageId,
                  role: LLM_MESSAGE_ROLE.assistant,
                  content: accumulatedValue,
                  isLoading: true,
                };
                addMessage(assistantMessage);
              } else {
                updateMessage(assistantMessageId, {
                  content: accumulatedValue,
                  isLoading: true,
                });
              }
            },
            signal: abortController.signal,
          });

        if (hasStartedStreaming) {
          updateMessage(assistantMessageId, {
            isLoading: false,
          });
        }

        const errorMessage = providerError || opikError || pythonProxyError;
        if (errorMessage) {
          throw new Error(errorMessage);
        }
      } catch (error) {
        const typedError = error as Error;
        const isStopped = typedError.name === "AbortError";

        if (!isStopped) {
          if (hasStartedStreaming) {
            updateMessage(assistantMessageId, {
              content: typedError.message,
              isLoading: false,
              isError: true,
            });
          } else {
            const errorMessage: OllieMessage = {
              id: assistantMessageId,
              role: LLM_MESSAGE_ROLE.assistant,
              content: typedError.message,
              isError: true,
            };
            addMessage(errorMessage);
          }

          toast({
            title: "Error",
            variant: "destructive",
            description: typedError.message,
          });
        }
      } finally {
        setIsThinking(false);
        stopStreaming();
      }
    },
    [
      messages,
      addMessage,
      updateMessage,
      runStreaming,
      startStreaming,
      stopStreaming,
      toast,
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4" ref={scrollContainerRef}>
        {noMessages ? (
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

      {/* Input area */}
      <div className="border-t bg-background px-4 py-3">
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

        <div className="comet-body-xs relative mt-2 pl-4 text-light-slate">
          <Info className="absolute left-0 top-0.5 size-3 shrink-0" />
          OllieAI is a prototype. Responses may not always be accurate.
        </div>
      </div>
    </div>
  );
};

export default OllieChatView;
