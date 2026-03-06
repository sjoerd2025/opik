export const isProdTag = (tag: string) => /^prod(uction)?$/i.test(tag);

export const sortTags = (tags: string[]) => [
  ...tags.filter(isProdTag),
  ...tags.filter((t) => !isProdTag(t)),
];

export const generateBlueprintDescription = (
  values: Array<{ key: string; value: unknown }>,
): string => {
  if (!values.length) return "";
  const changes = values.map(({ key, value }) => `${key} to ${value}`);
  return `Changed ${changes.join(", ")}.`;
};
