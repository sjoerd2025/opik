import React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { csv2json } from "json-2-csv";

interface CSVThumbnailProps {
  url: string;
  name: string;
}

const MAX_ROWS = 4;
const MAX_COLS = 4;

const CSVThumbnail: React.FC<CSVThumbnailProps> = ({ url, name }) => {
  const { data, isPending, isError } = useQuery({
    queryKey: ["csv-thumbnail", url],
    queryFn: async () => {
      const response = await fetch(url, {
        headers: { Range: "bytes=0-16383" },
      });
      const text = await response.text();
      // Drop the last (potentially partial) line from the range-fetched chunk
      const trimmed = text.includes("\n")
        ? text.slice(0, text.lastIndexOf("\n"))
        : text;
      const normalizedText = trimmed.replace(/\r\n|\r/g, "\n");
      const parsed = await csv2json(normalizedText, {
        excelBOM: true,
        trimHeaderFields: true,
        trimFieldValues: true,
      });
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Empty");
      }
      return parsed as Record<string, unknown>[];
    },
  });

  if (isPending) {
    return (
      <div className="flex size-full items-center justify-center rounded-sm bg-primary-foreground">
        <div className="size-8 animate-pulse rounded bg-slate-300" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex size-full items-center justify-center rounded-sm bg-primary-foreground">
        <FileSpreadsheet
          className="size-8 text-slate-300"
          strokeWidth={1.33}
          aria-label={name}
        />
      </div>
    );
  }

  const headers = Object.keys(data[0]).slice(0, MAX_COLS);
  const rows = data.slice(0, MAX_ROWS);
  const hasMoreCols = Object.keys(data[0]).length > MAX_COLS;
  const hasMoreRows = data.length > MAX_ROWS;

  return (
    <div className="size-full overflow-hidden rounded-sm">
      <table className="w-full border-collapse text-[9px] leading-tight">
        <thead className="bg-muted">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="truncate border border-border px-1 py-0.5 text-left font-medium"
                style={{ maxWidth: 48 }}
              >
                {h}
              </th>
            ))}
            {hasMoreCols && (
              <th className="border border-border px-1 py-0.5 text-muted-foreground">
                …
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td
                  key={h}
                  className="truncate border border-border px-1 py-0.5"
                  style={{ maxWidth: 48 }}
                >
                  {row[h] == null ? "" : String(row[h])}
                </td>
              ))}
              {hasMoreCols && (
                <td className="border border-border px-1 py-0.5 text-muted-foreground">
                  …
                </td>
              )}
            </tr>
          ))}
          {hasMoreRows && (
            <tr>
              {headers.map((h) => (
                <td
                  key={h}
                  className="border border-border px-1 py-0.5 text-center text-muted-foreground"
                >
                  …
                </td>
              ))}
              {hasMoreCols && (
                <td className="border border-border px-1 py-0.5 text-muted-foreground">
                  …
                </td>
              )}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default CSVThumbnail;
