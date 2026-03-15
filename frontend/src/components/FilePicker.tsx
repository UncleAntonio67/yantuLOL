import React, { useId, useMemo, useState } from "react";

export default function FilePicker(props: {
  name: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  label: string;
  hint?: string;
  onFilesChange?: (files: File[]) => void;
}) {
  const id = useId();
  const [names, setNames] = useState<string[]>([]);

  const summary = useMemo(() => {
    if (!names.length) return "未选择";
    if (names.length === 1) return names[0];
    return `已选择 ${names.length} 个文件`; 
  }, [names]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-wide text-gray-700">{props.label}</div>

      <label
        htmlFor={id}
        className={[
          "group block w-full cursor-pointer rounded-2xl border border-gray-200 bg-white/80 px-4 py-3",
          "hover:bg-white hover:border-brand-200 transition",
          "focus-within:ring-2 focus-within:ring-brand-200"
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{summary}</div>
            {props.hint && <div className="mt-1 text-[11px] text-gray-500 leading-5">{props.hint}</div>}
          </div>
          <div className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 group-hover:border-brand-200">
            选择文件
          </div>
        </div>

        <input
          id={id}
          name={props.name}
          type="file"
          accept={props.accept}
          multiple={!!props.multiple}
          required={!!props.required}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files || []);
            setNames(files.map((f) => f.name));
            props.onFilesChange?.(files);
          }}
        />
      </label>
    </div>
  );
}
