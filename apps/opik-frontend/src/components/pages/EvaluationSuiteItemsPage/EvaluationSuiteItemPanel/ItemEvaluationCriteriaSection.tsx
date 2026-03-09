import React, { useCallback, useMemo } from "react";
import { Settings2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import AssertionsField from "@/components/shared/AssertionField/AssertionsField";
import { ExecutionPolicy, MAX_RUNS_PER_ITEM } from "@/types/evaluation-suites";
import { Evaluator } from "@/types/datasets";
import {
  useEditItem,
  useDraftAssertionActions,
} from "@/store/EvaluationSuiteDraftStore";
import { extractAssertions } from "@/lib/assertion-converters";
import { useEffectiveSuiteAssertions } from "@/hooks/useEffectiveSuiteAssertions";
import { useEffectiveExecutionPolicy } from "@/hooks/useEffectiveExecutionPolicy";
import { useEffectiveItemAssertions } from "@/hooks/useEffectiveItemAssertions";
import { useEffectiveItemExecutionPolicy } from "@/hooks/useEffectiveItemExecutionPolicy";
import { useSuiteIdFromURL } from "@/hooks/useSuiteIdFromURL";
import { useClampedIntegerInput } from "@/hooks/useClampedIntegerInput";

interface ItemEvaluationCriteriaSectionProps {
  itemId: string;
  savedItemPolicy?: ExecutionPolicy;
  serverEvaluators: Evaluator[];
  onOpenSettings: () => void;
}

const ItemEvaluationCriteriaSection: React.FC<
  ItemEvaluationCriteriaSectionProps
> = ({ itemId, savedItemPolicy, serverEvaluators, onOpenSettings }) => {
  const editItem = useEditItem();
  const { updateItemAssertion, removeItemAssertion, addItemAssertion } =
    useDraftAssertionActions();
  const suiteId = useSuiteIdFromURL();
  const effectiveSuiteAssertions = useEffectiveSuiteAssertions(suiteId);
  const suitePolicy = useEffectiveExecutionPolicy(suiteId);

  // --- Execution policy ---

  const itemPolicy = useEffectiveItemExecutionPolicy(itemId, savedItemPolicy);
  const currentPolicy = itemPolicy ?? suitePolicy;

  const onRunsCommit = useCallback(
    (runs: number) => {
      editItem(itemId, {
        execution_policy: {
          runs_per_item: runs,
          pass_threshold: Math.min(currentPolicy.pass_threshold, runs),
        },
      });
    },
    [itemId, currentPolicy, editItem],
  );

  const onThresholdCommit = useCallback(
    (threshold: number) => {
      editItem(itemId, {
        execution_policy: {
          ...currentPolicy,
          pass_threshold: threshold,
        },
      });
    },
    [itemId, currentPolicy, editItem],
  );

  const runsInput = useClampedIntegerInput({
    value: currentPolicy.runs_per_item,
    min: 1,
    max: MAX_RUNS_PER_ITEM,
    onCommit: onRunsCommit,
  });

  const thresholdInput = useClampedIntegerInput({
    value: currentPolicy.pass_threshold,
    min: 1,
    max: currentPolicy.runs_per_item,
    onCommit: onThresholdCommit,
  });

  // --- Assertions ---

  const serverItemAssertions = useMemo(
    () => extractAssertions(serverEvaluators),
    [serverEvaluators],
  );
  const effectiveAssertions = useEffectiveItemAssertions(
    itemId,
    serverEvaluators,
  );

  return (
    <div>
      <h3 className="comet-body-accented mb-1">Evaluation criteria</h3>
      <p className="comet-body-s mb-4 text-light-slate">
        Define the conditions required for the evaluation to pass.
      </p>

      {/* Execution policy */}
      <div className="mb-4 flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <Label>Runs for this item</Label>
          <Input
            dimension="sm"
            className={cn("[&::-webkit-inner-spin-button]:appearance-none", {
              "border-destructive": runsInput.isInvalid,
            })}
            type="number"
            min={1}
            max={MAX_RUNS_PER_ITEM}
            value={runsInput.displayValue}
            onChange={runsInput.onChange}
            onFocus={runsInput.onFocus}
            onBlur={runsInput.onBlur}
            onKeyDown={runsInput.onKeyDown}
          />
          <span className="comet-body-xs text-light-slate">
            Global default is {suitePolicy.runs_per_item}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label>Pass threshold</Label>
          <Input
            dimension="sm"
            className={cn("[&::-webkit-inner-spin-button]:appearance-none", {
              "border-destructive": thresholdInput.isInvalid,
            })}
            type="number"
            min={1}
            max={currentPolicy.runs_per_item}
            value={thresholdInput.displayValue}
            onChange={thresholdInput.onChange}
            onFocus={thresholdInput.onFocus}
            onBlur={thresholdInput.onBlur}
            onKeyDown={thresholdInput.onKeyDown}
          />
          <span className="comet-body-xs text-light-slate">
            Global default is {suitePolicy.pass_threshold}
          </span>
        </div>
      </div>

      {/* Assertions subsection */}
      <div className="flex flex-col gap-1">
        <span className="comet-body-s-accented">Assertions</span>
        <div className="flex items-center justify-between">
          <span className="comet-body-s text-light-slate">
            Define the conditions for this evaluation to pass
          </span>
          <button
            type="button"
            className="comet-body-s inline-flex shrink-0 items-center gap-1 border-b border-foreground text-foreground"
            onClick={onOpenSettings}
          >
            <Settings2 className="size-3.5 shrink-0" />
            Manage global assertions
          </button>
        </div>

        <AssertionsField
          readOnlyAssertions={effectiveSuiteAssertions}
          editableAssertions={effectiveAssertions}
          onChangeEditable={(index, value) =>
            updateItemAssertion(itemId, index, value, serverItemAssertions)
          }
          onRemoveEditable={(index) =>
            removeItemAssertion(itemId, index, serverItemAssertions)
          }
          onAdd={() => addItemAssertion(itemId, serverItemAssertions)}
        />
      </div>
    </div>
  );
};

export default ItemEvaluationCriteriaSection;
