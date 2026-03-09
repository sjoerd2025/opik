import React, { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { z } from "zod";

import {
  BlueprintType,
  BlueprintValue,
  BlueprintValueType,
  ConfigHistoryItem,
} from "@/types/agent-configs";
import useAgentConfigById from "@/api/agent-configs/useAgentConfigById";
import useAgentConfigCreateMutation from "@/api/agent-configs/useAgentConfigCreateMutation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Loader from "@/components/shared/Loader/Loader";
import BlueprintTypeIcon from "./BlueprintTypeIcon";
import BlueprintValuePrompt, {
  BlueprintValuePromptHandle,
} from "./BlueprintValuePrompt";
import { Separator } from "@/components/ui/separator";

type ConfigurationEditViewProps = {
  item: ConfigHistoryItem;
  projectId: string;
  version: number;
  onCancel: () => void;
  onSaved: () => void;
};

const nonEmptyString = z.string().min(1, "Must not be empty");

const FIELD_SCHEMAS: Partial<Record<BlueprintValueType, z.ZodType>> = {
  [BlueprintValueType.INT]: nonEmptyString.pipe(
    z.coerce.number().int("Must be an integer"),
  ),
  [BlueprintValueType.FLOAT]: nonEmptyString.pipe(
    z.coerce.number({ message: "Must be a valid number" }),
  ),
  [BlueprintValueType.STRING]: nonEmptyString,
};

const validateField = (type: string, value: string): string => {
  const schema = FIELD_SCHEMAS[type as BlueprintValueType];
  if (!schema) return "";
  const result = schema.safeParse(value.trim());
  return result.success ? "" : result.error.issues[0].message;
};

const ConfigurationEditView: React.FC<ConfigurationEditViewProps> = ({
  item,
  projectId,
  version,
  onCancel,
  onSaved,
}) => {
  const { data: agentConfig, isPending } = useAgentConfigById({
    blueprintId: item.id,
  });
  const { mutate: createConfig, isPending: isSaving } =
    useAgentConfigCreateMutation();

  const [description, setDescription] = useState("");
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirtyPromptKeys, setDirtyPromptKeys] = useState<
    Record<string, boolean>
  >({});
  const originalValues = useRef<Record<string, string>>({});
  const initialized = useRef(false);
  const promptRefs = useRef<Record<string, BlueprintValuePromptHandle | null>>(
    {},
  );

  useEffect(() => {
    if (agentConfig && !initialized.current) {
      initialized.current = true;
      const initial: Record<string, string> = {};
      agentConfig.values
        .filter((v) => v.type !== BlueprintValueType.PROMPT)
        .forEach((v) => {
          initial[v.key] = v.value;
        });
      originalValues.current = initial;
      setDraftValues(initial);
    }
  }, [agentConfig]);

  const handleFieldChange = (key: string, value: string) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const hasErrors = Object.values(errors).some(Boolean);

  const handleSave = async () => {
    if (!agentConfig) return;

    const newErrors: Record<string, string> = {};
    agentConfig.values
      .filter(
        (v) =>
          v.type !== BlueprintValueType.PROMPT &&
          v.type !== BlueprintValueType.BOOLEAN,
      )
      .forEach((v) => {
        const err = validateField(v.type, draftValues[v.key] ?? "");
        if (err) newErrors[v.key] = err;
      });

    if (Object.values(newErrors).some(Boolean)) {
      setErrors(newErrors);
      return;
    }

    await Promise.all(
      Object.values(promptRefs.current)
        .filter(Boolean)
        .map((handle) => handle!.saveVersion()),
    );

    const values: BlueprintValue[] = agentConfig.values.map((v) => ({
      key: v.key,
      type: v.type,
      value:
        v.type !== BlueprintValueType.PROMPT
          ? draftValues[v.key] ?? v.value
          : v.value,
      ...(v.description ? { description: v.description } : {}),
    }));

    createConfig(
      {
        agentConfig: {
          project_id: projectId,
          blueprint: {
            description: description || undefined,
            type: BlueprintType.BLUEPRINT,
            values,
          },
        },
      },
      { onSuccess: onSaved },
    );
  };

  if (isPending) {
    return <Loader />;
  }

  return (
    <Card className="mx-6 my-4 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="comet-title-s">Create new version</h2>
          <div className="comet-body-xs flex items-center gap-1 rounded bg-[#FF5A3C] px-2 py-0.5 text-white">
            <Pencil className="size-2.5" />
            From v{version}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || hasErrors}
          >
            {isSaving ? "Saving…" : "Save as new version"}
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <label className="comet-body-xs-accented mb-1.5 block text-foreground">
          Description
        </label>
        <Input
          placeholder="Describe what changed in this version…"
          value={description}
          dimension="sm"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <Separator orientation="horizontal" />

      <div className="flex flex-col divide-y">
        {(agentConfig?.values ?? []).map((v) => {
          const isChanged =
            v.type === BlueprintValueType.PROMPT
              ? !!dirtyPromptKeys[v.key]
              : draftValues[v.key] !== undefined &&
                draftValues[v.key] !== originalValues.current[v.key];
          return (
            <div key={v.key} className="flex flex-col gap-2 py-3">
              <div className="flex items-center gap-2">
                <BlueprintTypeIcon type={v.type} variant="secondary" />
                <span className="comet-body-xs-accented text-foreground">
                  {v.key}
                </span>
                {isChanged && (
                  <span className="size-1.5 rounded-full bg-amber-400" />
                )}
              </div>
              {v.description && (
                <span className="comet-body-xs text-light-slate">
                  {v.description}
                </span>
              )}
              {v.type === BlueprintValueType.PROMPT ? (
                <BlueprintValuePrompt
                  value={v}
                  isEditing
                  ref={(el) => {
                    promptRefs.current[v.key] = el;
                  }}
                  onDirtyChange={(isDirty) =>
                    setDirtyPromptKeys((prev) => ({
                      ...prev,
                      [v.key]: isDirty,
                    }))
                  }
                />
              ) : v.type === BlueprintValueType.BOOLEAN ? (
                <Switch
                  checked={draftValues[v.key] === "true"}
                  onCheckedChange={(checked) =>
                    setDraftValues((prev) => ({
                      ...prev,
                      [v.key]: String(checked),
                    }))
                  }
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <Input
                    inputMode={
                      v.type === BlueprintValueType.INT
                        ? "numeric"
                        : v.type === BlueprintValueType.FLOAT
                          ? "decimal"
                          : "text"
                    }
                    value={draftValues[v.key] ?? ""}
                    onChange={(e) => handleFieldChange(v.key, e.target.value)}
                  />
                  {errors[v.key] && (
                    <span className="comet-body-xs text-red-500">
                      {errors[v.key]}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default ConfigurationEditView;
