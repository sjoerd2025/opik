import React, { useMemo } from "react";
import { Span, Trace } from "@/types/traces";
import { useUnifiedMedia } from "@/hooks/useUnifiedMedia";
import { MediaProvider } from "@/components/shared/PrettyLLMMessage/llmMessages";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import SyntaxHighlighter from "@/components/shared/SyntaxHighlighter/SyntaxHighlighter";
import MarkdownPreview from "@/components/shared/MarkdownPreview/MarkdownPreview";
import AttachmentsList from "./AttachmentsList";
import EventsList from "./EventsList";
import Loader from "@/components/shared/Loader/Loader";

type DetailsTabProps = {
  data: Trace | Span;
  isLoading: boolean;
  search?: string;
};

const DetailsTab: React.FunctionComponent<DetailsTabProps> = ({
  data,
  isLoading,
  search,
}) => {
  // Use unified media hook to fetch all media and get transformed data
  const { media, transformedInput, transformedOutput } = useUnifiedMedia(data);

  const hasError = Boolean(data.error_info);
  const hasTokenUsage = Boolean(data.usage);

  const metadataRecord = data.metadata as Record<string, unknown> | undefined;
  const sourceCode =
    typeof metadataRecord?.source_code === "string"
      ? metadataRecord.source_code
      : null;

  const metadataWithoutSourceCode = useMemo(() => {
    if (!data.metadata) return null;
    if (!sourceCode) return data.metadata;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { source_code, ...rest } = metadataRecord as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : null;
  }, [data.metadata, metadataRecord, sourceCode]);

  const hasMetadata = Boolean(metadataWithoutSourceCode);

  // Compute default open sections based on what's available
  const openSections = useMemo(() => {
    const sections = ["input", "output", "events"];
    if (hasError) sections.unshift("error");
    if (sourceCode) sections.push("source_code");
    if (hasMetadata) sections.push("metadata");
    if (hasTokenUsage) sections.push("usage");
    // Attachments is handled by AttachmentsList which manages its own accordion
    sections.unshift("attachments");
    return sections;
  }, [hasError, hasMetadata, hasTokenUsage, sourceCode]);

  return (
    <MediaProvider media={media}>
      <Accordion type="multiple" className="w-full" defaultValue={openSections}>
        {/* Order: Attachments, Error (if exists), Input, Output, Events, Metadata, Token usage (if exists) */}
        <AttachmentsList media={media} />
        {hasError && (
          <AccordionItem className="group" value="error" disabled={isLoading}>
            <AccordionTrigger>Error</AccordionTrigger>
            <AccordionContent
              forceMount
              className="group-data-[state=closed]:hidden"
            >
              {isLoading ? (
                <Loader />
              ) : (
                <SyntaxHighlighter
                  data={data.error_info!}
                  preserveKey="syntax-highlighter-trace-sidebar-error"
                  withSearch
                  search={search}
                />
              )}
            </AccordionContent>
          </AccordionItem>
        )}
        <AccordionItem className="group" value="input" disabled={isLoading}>
          <AccordionTrigger>Input</AccordionTrigger>
          <AccordionContent
            forceMount
            className="group-data-[state=closed]:hidden"
          >
            {isLoading ? (
              <Loader />
            ) : (
              <SyntaxHighlighter
                data={transformedInput}
                prettifyConfig={{ fieldType: "input" }}
                preserveKey="syntax-highlighter-trace-sidebar-input"
                search={search}
                withSearch
              />
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem className="group" value="output" disabled={isLoading}>
          <AccordionTrigger>Output</AccordionTrigger>
          <AccordionContent
            forceMount
            className="group-data-[state=closed]:hidden"
          >
            {isLoading ? (
              <Loader />
            ) : (
              <SyntaxHighlighter
                data={transformedOutput}
                prettifyConfig={{ fieldType: "output" }}
                preserveKey="syntax-highlighter-trace-sidebar-output"
                search={search}
                withSearch
              />
            )}
          </AccordionContent>
        </AccordionItem>
        <EventsList data={data} isLoading={isLoading} search={search} />
        {sourceCode && (
          <AccordionItem className="group" value="source_code">
            <AccordionTrigger>Source code</AccordionTrigger>
            <AccordionContent
              forceMount
              className="group-data-[state=closed]:hidden"
            >
              <MarkdownPreview>{sourceCode}</MarkdownPreview>
            </AccordionContent>
          </AccordionItem>
        )}
        {hasMetadata && (
          <AccordionItem className="group" value="metadata">
            <AccordionTrigger>Metadata</AccordionTrigger>
            <AccordionContent
              forceMount
              className="group-data-[state=closed]:hidden"
            >
              <SyntaxHighlighter
                withSearch
                data={metadataWithoutSourceCode!}
                search={search}
              />
            </AccordionContent>
          </AccordionItem>
        )}
        {hasTokenUsage && (
          <AccordionItem className="group" value="usage">
            <AccordionTrigger>Token usage</AccordionTrigger>
            <AccordionContent
              forceMount
              className="group-data-[state=closed]:hidden"
            >
              <SyntaxHighlighter
                data={data.usage as object}
                withSearch
                search={search}
              />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </MediaProvider>
  );
};

export default DetailsTab;
