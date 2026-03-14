import React from "react";
import Button from "./Button";

export default function Pagination(props: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (nextPage: number) => void;
  className?: string;
}) {
  const { page, pageSize, total, onPageChange } = props;
  const totalPages = Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize || 1)));
  const safePage = Math.min(Math.max(1, page), totalPages);

  return (
    <div className={["flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3", props.className].filter(Boolean).join(" ")}>
      <div className="text-xs text-gray-600">
        第 <span className="font-semibold text-gray-900">{safePage}</span> / <span className="font-semibold text-gray-900">{totalPages}</span> 页
        <span className="ml-2">共 {total} 条</span>
      </div>
      <div className="flex gap-2">
        <Button tone="ghost" type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          上一页
        </Button>
        <Button tone="ghost" type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}

