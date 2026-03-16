import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import isString from "lodash/isString";
import { csv2json } from "json-2-csv";
import { Download } from "lucide-react";

import Loader from "@/components/shared/Loader/Loader";
import NoData from "@/components/shared/NoData/NoData";
import { Button } from "@/components/ui/button";

const SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

type CSVPreviewData =
  | { tooLarge: true }
  | { tooLarge: false; rows: Record<string, unknown>[] };

interface CSVPreviewProps {
  url: string;
  name?: string;
}

const CSVPreview: React.FC<CSVPreviewProps> = ({ url, name }) => {
  const { data, isPending, isError, error } = useQuery<CSVPreviewData>({
    queryKey: ["csv", url],
    queryFn: async () => {
      try {
        const headResponse = await fetch(url, { method: "HEAD" });
        const contentLength = parseInt(
          headResponse.headers.get("Content-Length") ?? "",
          10,
        );
        if (!isNaN(contentLength) && contentLength > SIZE_LIMIT) {
          return { tooLarge: true };
        }

        const response = await fetch(url);
        const text = await response.text();
        const normalizedText = text.replace(/\r\n|\r/g, "\n");
        const parsed = await csv2json(normalizedText, {
          excelBOM: true,
          trimHeaderFields: true,
          trimFieldValues: true,
        });

        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("CSV file is empty or invalid");
        }

        return { tooLarge: false, rows: parsed as Record<string, unknown>[] };
      } catch (error) {
        let message: string | undefined;
        if (isString(error)) {
          message = error;
        } else if (error instanceof Error) {
          message = error.message;
        }
        throw new Error(
          message ?? "Failed to fetch CSV. CORS issue or invalid file.",
        );
      }
    },
  });

  const rows = useMemo(() => (!data || data.tooLarge ? [] : data.rows), [data]);

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    const firstRow = rows[0];
    return Object.keys(firstRow).map((key) => ({
      accessorKey: key,
      header: key,
      cell: (info: { getValue: () => unknown }) => {
        const value = info.getValue();
        if (value === null || value === undefined) return "";
        return String(value);
      },
    }));
  }, [rows]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 35,
    overscan: 10,
  });

  const renderContent = () => {
    if (isPending) return <Loader />;

    if (isError) return <NoData icon={null} message={error?.message} />;

    if (!data) return <NoData message="CSV file is empty" icon={null} />;

    if (data.tooLarge) {
      return (
        <div className="flex size-full flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">
            This file is too large to preview.
          </p>
          <Button asChild variant="outline">
            <a href={url} download={name ?? true}>
              <Download className="mr-2 size-4" />
              Download
            </a>
          </Button>
        </div>
      );
    }

    if (data.rows.length === 0) {
      return <NoData message="CSV file is empty" icon={null} />;
    }

    return (
      <div
        ref={tableContainerRef}
        className="relative h-full overflow-auto"
        style={{ height: "100%" }}
      >
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border border-border px-4 py-2 text-left font-medium"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = tableRows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${
                      virtualRow.start - virtualRow.index * virtualRow.size
                    }px)`,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="border border-border px-4 py-2"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="relative flex size-full justify-center overflow-hidden pb-10">
      {renderContent()}
    </div>
  );
};

export default CSVPreview;
