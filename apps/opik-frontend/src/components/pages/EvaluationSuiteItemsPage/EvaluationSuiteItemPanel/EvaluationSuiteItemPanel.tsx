import React, { useCallback, useMemo } from "react";
import { Copy, MoreHorizontal, Share, Trash } from "lucide-react";
import copy from "clipboard-copy";
import {
  DatasetItemColumn,
  DatasetItemWithDraft,
  Evaluator,
  DATASET_ITEM_DRAFT_STATUS,
} from "@/types/datasets";
import { ExecutionPolicy } from "@/types/evaluation-suites";
import {
  DatasetItemEditorAutosaveProvider,
  useDatasetItemEditorAutosaveContext,
} from "@/components/pages-shared/datasets/DatasetItemEditor/DatasetItemEditorAutosaveContext";
import ResizableSidePanel from "@/components/shared/ResizableSidePanel/ResizableSidePanel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import Loader from "@/components/shared/Loader/Loader";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import TagListRenderer from "@/components/shared/TagListRenderer/TagListRenderer";
import { Separator } from "@/components/ui/separator";
import ItemDescriptionSection from "./ItemDescriptionSection";
import ItemEvaluationCriteriaSection from "./ItemEvaluationCriteriaSection";
import ItemContextSection from "./ItemContextSection";

interface EvaluationSuiteItemPanelProps {
  datasetItemId: string;
  datasetId: string;
  columns: DatasetItemColumn[];
  onClose: () => void;
  isOpen: boolean;
  rows: DatasetItemWithDraft[];
  setActiveRowId: (id: string) => void;
  onOpenSettings: () => void;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

interface EvaluationSuiteItemPanelLayoutProps {
  datasetItemId: string;
  isOpen: boolean;
  onClose: () => void;
  savedItemPolicy?: ExecutionPolicy;
  serverEvaluators: Evaluator[];
  onOpenSettings: () => void;
  isNewItem: boolean;
}

const EvaluationSuiteItemPanelLayout: React.FC<
  EvaluationSuiteItemPanelLayoutProps
> = ({
  datasetItemId,
  isOpen,
  onClose,
  savedItemPolicy,
  serverEvaluators,
  onOpenSettings,
  isNewItem,
}) => {
  const {
    isPending,
    handleDelete,
    horizontalNavigation,
    tags,
    handleAddTag,
    handleDeleteTag,
  } = useDatasetItemEditorAutosaveContext();

  const { toast } = useToast();

  const handleShare = useCallback(() => {
    toast({ description: "URL successfully copied to clipboard" });
    copy(window.location.href);
  }, [toast]);

  const handleCopyId = useCallback(() => {
    toast({ description: "Item ID successfully copied to clipboard" });
    copy(datasetItemId);
  }, [datasetItemId, toast]);

  const handleDeleteItemConfirm = useCallback(() => {
    handleDelete(onClose);
  }, [handleDelete, onClose]);

  const headerContent = useMemo(
    () =>
      isNewItem ? null : (
        <div className="flex flex-auto items-center justify-end pl-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm">
                <span className="sr-only">Actions menu</span>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={handleShare}>
                <Share className="mr-2 size-4" />
                Share item
              </DropdownMenuItem>
              <TooltipWrapper content={datasetItemId} side="left">
                <DropdownMenuItem onClick={handleCopyId}>
                  <Copy className="mr-2 size-4" />
                  Copy item ID
                </DropdownMenuItem>
              </TooltipWrapper>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDeleteItemConfirm}>
                <Trash className="mr-2 size-4" />
                Delete item
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    [
      isNewItem,
      datasetItemId,
      handleShare,
      handleCopyId,
      handleDeleteItemConfirm,
    ],
  );

  return (
    <ResizableSidePanel
      panelId="evaluation-suite-item-panel"
      entity="item"
      open={isOpen}
      headerContent={headerContent}
      onClose={onClose}
      horizontalNavigation={isNewItem ? undefined : horizontalNavigation}
    >
      {isPending ? (
        <div className="flex size-full items-center justify-center">
          <Loader />
        </div>
      ) : (
        <div className="relative size-full overflow-y-auto">
          <div className="sticky top-0 z-10 border-b bg-background p-6 pb-4">
            <div className="comet-body-accented">
              {isNewItem ? (
                "New evaluation suite item"
              ) : (
                <>
                  Evaluation suite item{" "}
                  <TooltipWrapper content={datasetItemId}>
                    <span className="comet-body-s text-muted-slate">
                      {truncateId(datasetItemId)}
                    </span>
                  </TooltipWrapper>
                </>
              )}
            </div>
            <TagListRenderer
              tags={tags}
              onAddTag={handleAddTag}
              onDeleteTag={handleDeleteTag}
              size="sm"
              align="start"
            />
          </div>

          <div className="flex flex-col gap-6 p-6 pt-4">
            <ItemDescriptionSection itemId={datasetItemId} />
            <ItemContextSection />
            <Separator />
            <ItemEvaluationCriteriaSection
              itemId={datasetItemId}
              savedItemPolicy={savedItemPolicy}
              serverEvaluators={serverEvaluators}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>
      )}
    </ResizableSidePanel>
  );
};

const EvaluationSuiteItemPanel: React.FC<EvaluationSuiteItemPanelProps> = ({
  datasetItemId,
  datasetId,
  columns,
  onClose,
  isOpen,
  rows,
  setActiveRowId,
  onOpenSettings,
}) => {
  const activeRow = useMemo(
    () => rows.find((r) => r.id === datasetItemId),
    [rows, datasetItemId],
  );

  const isNewItem = activeRow?.draftStatus === DATASET_ITEM_DRAFT_STATUS.added;
  const itemExecutionPolicy = activeRow?.execution_policy;
  const serverEvaluators = activeRow?.evaluators ?? [];

  return (
    <DatasetItemEditorAutosaveProvider
      datasetItemId={datasetItemId}
      datasetId={datasetId}
      columns={columns}
      rows={rows}
      setActiveRowId={setActiveRowId}
    >
      <EvaluationSuiteItemPanelLayout
        datasetItemId={datasetItemId}
        isOpen={isOpen}
        onClose={onClose}
        savedItemPolicy={itemExecutionPolicy}
        serverEvaluators={serverEvaluators}
        onOpenSettings={onOpenSettings}
        isNewItem={isNewItem}
      />
    </DatasetItemEditorAutosaveProvider>
  );
};

export default EvaluationSuiteItemPanel;
