"use client";

import type { ImportResult } from "@/modules/domain/forecast/types";

export function ImportResultCard({ title, result }: { title: string; result: ImportResult }) {
  return (
    <div className={`p-4 rounded-2xl ${result.success ? "bg-green-50/70" : "bg-red-50/70"}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-[#1d1d1f]">{title}</span>
        <span className={`text-sm ${result.success ? "text-green-700" : "text-red-700"}`}>
          {result.success ? `成功导入 ${result.importedRows} 条` : "导入失败"}
        </span>
      </div>
      {result.errors.length > 0 && (
        <div className="mt-2 text-sm text-red-600">
          {result.errors.map((e, i) => (<p key={i}>{e}</p>))}
        </div>
      )}
      {result.unmatchedProducts && result.unmatchedProducts.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-amber-700 font-medium">未匹配商品 ({result.unmatchedProducts.length}):</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {result.unmatchedProducts.slice(0, 20).map((p) => (
              <span key={p} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs">{p}</span>
            ))}
            {result.unmatchedProducts.length > 20 && (
              <span className="text-xs text-amber-600">... 还有 {result.unmatchedProducts.length - 20} 个</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
