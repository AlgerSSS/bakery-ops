"use client";

import { useState, useEffect } from "react";
import { useSettings } from "@/ui/hooks/use-settings";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import { ImportResultCard } from "@/ui/components/shared/import-result-card";
import type { Holiday } from "@/modules/domain/forecast/types";

export function SettingsPage() {
  const { showToast } = useToastContext();
  void showToast;
  const settings = useSettings();
  const {
    settingsTab, setSettingsTab, rulesSaving, loadRulesData,
    businessRulesState, fixedSchedule, aliases,
    handleSaveBusinessRule, handleSaveAlias, handleDeleteAlias, handleSaveSchedule,
    handleAddHoliday, handleDeleteHoliday, handleAutoImport, handleFileImport,
    holidaysList, newAliasKey, setNewAliasKey, newAliasValue, setNewAliasValue,
    editingScheduleProduct, setEditingScheduleProduct, editingScheduleSlots, setEditingScheduleSlots,
    newHolidayDate, setNewHolidayDate, newHolidayName, setNewHolidayName,
    newHolidayType, setNewHolidayType, newHolidayNote, setNewHolidayNote,
    importStatus, products, strategies, baselines, dataLoaded, loading,
  } = settings;

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-4">
        <div className="flex gap-1 bg-gray-50 rounded-full p-1 w-fit mx-auto">
          {([["data", "数据导入"], ["business", "业务规则"], ["schedule", "出货时间表"], ["alias", "产品别名"], ["holiday", "节假日"], ["product_config", "产品属性"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => { setSettingsTab(id); if (id !== "data") loadRulesData(); }} className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300 ${settingsTab === id ? "bg-[#0071e3] text-white shadow-sm" : "text-[#86868b] hover:text-[#1d1d1f]"}`}>{label}</button>
          ))}
        </div>
      </div>

      {settingsTab === "data" && (
        <>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <h2 className="text-lg font-semibold text-[#1d1d1f] mb-4">数据库状态</h2>
            {dataLoaded ? (
              <div className="bg-green-50/70 rounded-2xl p-4">
                <p className="text-green-800 font-medium text-sm">数据已从数据库加载</p>
                <div className="mt-2 grid grid-cols-3 gap-4 text-sm text-green-700">
                  <div>产品: <span className="font-semibold">{products.length}</span> 个</div>
                  <div>策略: <span className="font-semibold">{strategies.length}</span> 个</div>
                  <div>基线: <span className="font-semibold">{baselines.length}</span> 个</div>
                </div>
              </div>
            ) : loading ? (
              <div className="bg-[#0071e3]/15 rounded-2xl p-4"><p className="text-[#1d1d1f] text-sm">正在从数据库加载数据...</p></div>
            ) : (
              <div className="bg-amber-50/70 rounded-2xl p-4"><p className="text-amber-800 text-sm">数据库暂无数据，请先从 Excel 导入。</p></div>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1d1d1f]">从 Excel 重新导入</h2>
                <p className="text-sm text-[#86868b] mt-1">从 data 目录重新导入产品价格、销售数据和策略数据到数据库（将覆盖现有数据）。</p>
              </div>
              <button onClick={handleAutoImport} disabled={loading} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">从 Excel 重新导入</button>
            </div>
            {importStatus.products && (
              <div className="mt-6 space-y-3">
                <ImportResultCard title="产品价格" result={importStatus.products} />
                <ImportResultCard title="销售策略" result={importStatus.strategy!} />
                <ImportResultCard title="销售数据" result={importStatus.sales!} />
                {importStatus.timeslot && <ImportResultCard title="分时段销售" result={importStatus.timeslot} />}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <h2 className="text-lg font-semibold text-[#1d1d1f] mb-1">上传 Excel 文件导入</h2>
            <p className="text-sm text-[#86868b] mb-4">逐个上传 Excel 文件更新对应数据（不影响其他数据）。</p>
            <div className="space-y-3">
              {([
                ["products", "产品价格", "产品价格信息与倍数.xlsx"],
                ["sales", "销售数据", "单品销售数量.xlsx"],
                ["strategy", "销售策略", "产品销售策略.xlsx"],
              ] as const).map(([type, label, hint]) => (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[#1d1d1f] w-20">{label}</span>
                  <label className="flex-1 cursor-pointer">
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      disabled={loading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileImport(type, file);
                        e.target.value = "";
                      }}
                    />
                    <span className="block w-full border border-dashed border-gray-200 rounded-xl px-4 py-2 text-sm text-[#86868b] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors duration-200 text-center">
                      {loading ? "导入中..." : `选择 ${hint}`}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          </div>
          {products.length > 0 && (
            <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
              <h3 className="text-md font-semibold text-[#1d1d1f] mb-3">已导入产品 ({products.length} 个)</h3>
              <div className="overflow-x-auto rounded-xl">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50/50"><tr>
                    <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">品类</th>
                    <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">品名</th>
                    <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">单价</th>
                    <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">倍数</th>
                    <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">类型</th>
                  </tr></thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50">
                        <td className="px-3 py-2">{p.category}</td>
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 text-right">{p.price}</td>
                        <td className="px-3 py-2 text-right">{p.packMultiple}</td>
                        <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${p.unitType === "batch" ? "bg-[#0071e3] text-white" : "bg-green-100 text-green-700"}`}>{p.unitType === "batch" ? "整批" : "按个"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {settingsTab === "business" && (
        <div className="space-y-4">
          {!businessRulesState ? (
            <div className="p-4 rounded-2xl bg-gray-50 text-[#86868b] text-sm">正在加载业务规则...</div>
          ) : (<>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-[#1d1d1f]">首月基础营业额</label>
              <input type="number" key={`rev-${businessRulesState?.firstMonthRevenue}`} defaultValue={businessRulesState?.firstMonthRevenue ?? 1640000} onBlur={(e) => handleSaveBusinessRule("firstMonthRevenue", Number(e.target.value))} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
            </div>
            <div>
              <label className="text-sm font-medium text-[#1d1d1f]">总赋能增幅</label>
              <input type="number" step="0.01" key={`enh-${businessRulesState?.totalEnhancement}`} defaultValue={businessRulesState?.totalEnhancement ?? 0.06} onBlur={(e) => handleSaveBusinessRule("totalEnhancement", Number(e.target.value))} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">日权重配置</label>
            <div className="grid grid-cols-4 gap-3 mt-1">
              {([["mondayToThursday", "周一至周四(整体)"], ["friday", "周五"], ["saturday", "周六"], ["sunday", "周日"]] as const).map(([key, label]) => (
                <div key={key}>
                  <span className="text-xs text-[#86868b]">{label}</span>
                  <input type="number" step="0.01"
                    key={`wt-${key}-${businessRulesState?.weekdayWeights?.[key]}`}
                    defaultValue={businessRulesState?.weekdayWeights?.[key]}
                    placeholder={key === "mondayToThursday" ? "1.0" : key === "friday" ? "1.2" : "1.35"}
                    onBlur={(e) => {
                      const current = businessRulesState?.weekdayWeights;
                      if (!current) return;
                      handleSaveBusinessRule("weekdayWeights", { ...current, [key]: Number(e.target.value) });
                    }} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">周一至周四细分系数 <span className="text-xs text-[#86868b] font-normal">（相对于周一至周四整体的比例，均值应≈1.0）</span></label>
            <div className="grid grid-cols-4 gap-3 mt-1">
              {([["monday", "周一", 1.025], ["tuesday", "周二", 0.976], ["wednesday", "周三", 0.981], ["thursday", "周四", 1.017]] as const).map(([key, label, def]) => (
                <div key={key}>
                  <span className="text-xs text-[#86868b]">{label}</span>
                  <input type="number" step="0.001"
                    key={`dow-${key}-${businessRulesState?.prophetDowWeights?.[key]}`}
                    defaultValue={businessRulesState?.prophetDowWeights?.[key]}
                    placeholder={String(def)}
                    onBlur={(e) => {
                      const current = businessRulesState?.prophetDowWeights ?? { monday: 1.025, tuesday: 0.976, wednesday: 0.981, thursday: 1.017 };
                      handleSaveBusinessRule("prophetDowWeights", { ...current, [key]: Number(e.target.value) });
                    }} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">出货公式</label>
            <div className="grid grid-cols-3 gap-3 mt-1">
              {([["tastingWasteRate", "品鉴损耗率", 0.06], ["waterBarRate", "水吧占比", 0.11], ["shipmentRate", "出货率", 0.95]] as const).map(([key, label, def]) => (
                <div key={key}>
                  <span className="text-xs text-[#86868b]">{label}</span>
                  <input type="number" step="0.01"
                    key={`sf-${key}-${businessRulesState?.shipmentFormula?.[key]}`}
                    defaultValue={businessRulesState?.shipmentFormula?.[key]}
                    placeholder={String(def)}
                    onBlur={(e) => {
                      const current = businessRulesState?.shipmentFormula;
                      if (!current) return;
                      handleSaveBusinessRule("shipmentFormula", { ...current, [key]: Number(e.target.value) });
                    }} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
                </div>
              ))}
            </div>
          </div>
          {rulesSaving && <p className="text-sm text-[#0071e3] font-medium">保存中...</p>}
          </>)}
        </div>
      )}

      {settingsTab === "schedule" && (
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-[#86868b]">产品名</label>
              <input value={editingScheduleProduct} onChange={(e) => setEditingScheduleProduct(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="产品名称" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#86868b]">时段（逗号分隔）</label>
              <input value={editingScheduleSlots} onChange={(e) => setEditingScheduleSlots(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="11:00, 15:00, 18:00" />
            </div>
            <button onClick={handleSaveSchedule} disabled={rulesSaving} className="bg-[#0071e3] text-white px-4 py-1.5 rounded-xl text-sm hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">保存</button>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50/50 sticky top-0"><tr>
                <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">产品</th>
                <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">出货时段</th>
                <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">操作</th>
              </tr></thead>
              <tbody>
                {Object.entries(fixedSchedule).map(([name, slots]) => (
                  <tr key={name} className="hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50">
                    <td className="px-3 py-1.5 font-medium text-xs">{name}</td>
                    <td className="px-3 py-1.5 text-xs text-[#86868b]">{slots.join(", ")}</td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={() => { setEditingScheduleProduct(name); setEditingScheduleSlots(slots.join(", ")); }} className="text-[#1d1d1f] text-xs hover:text-[#0071e3] transition-colors duration-200">编辑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {settingsTab === "alias" && (
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-[#86868b]">别名</label>
              <input value={newAliasKey} onChange={(e) => setNewAliasKey(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="销售系统中的名称" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#86868b]">标准名</label>
              <input value={newAliasValue} onChange={(e) => setNewAliasValue(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="对应的标准产品名" />
            </div>
            <button onClick={handleSaveAlias} disabled={rulesSaving} className="bg-[#0071e3] text-white px-4 py-1.5 rounded-xl text-sm hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">添加</button>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50/50 sticky top-0"><tr>
                <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">别名</th>
                <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">标准名</th>
                <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">操作</th>
              </tr></thead>
              <tbody>
                {Object.entries(aliases).map(([alias, stdName]) => (
                  <tr key={alias} className="hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50">
                    <td className="px-3 py-1.5 text-xs">{alias}</td>
                    <td className="px-3 py-1.5 text-xs font-medium">{stdName}</td>
                    <td className="px-3 py-1.5 text-center"><button onClick={() => handleDeleteAlias(alias)} className="text-red-400 text-xs hover:text-red-600 transition-colors duration-200">删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {settingsTab === "holiday" && (
        <SettingsHolidayTab
          holidaysList={holidaysList}
          newHolidayDate={newHolidayDate} setNewHolidayDate={setNewHolidayDate}
          newHolidayName={newHolidayName} setNewHolidayName={setNewHolidayName}
          newHolidayType={newHolidayType} setNewHolidayType={setNewHolidayType}
          newHolidayNote={newHolidayNote} setNewHolidayNote={setNewHolidayNote}
          handleAddHoliday={handleAddHoliday} handleDeleteHoliday={handleDeleteHoliday}
          rulesSaving={rulesSaving}
        />
      )}

      {settingsTab === "product_config" && <ProductConfigTab />}
    </div>
  );
}

function SettingsHolidayTab({
  holidaysList, newHolidayDate, setNewHolidayDate, newHolidayName, setNewHolidayName,
  newHolidayType, setNewHolidayType, newHolidayNote, setNewHolidayNote,
  handleAddHoliday, handleDeleteHoliday, rulesSaving,
}: {
  holidaysList: Holiday[]; newHolidayDate: string; setNewHolidayDate: (v: string) => void;
  newHolidayName: string; setNewHolidayName: (v: string) => void;
  newHolidayType: Holiday["type"]; setNewHolidayType: (v: Holiday["type"]) => void;
  newHolidayNote: string; setNewHolidayNote: (v: string) => void;
  handleAddHoliday: () => void; handleDeleteHoliday: (id: number) => void; rulesSaving: boolean;
}) {
  const typeLabels: Record<string, string> = { public_holiday: "法定公假", festival: "重要节日", promotion: "促销活动", ramadan: "斋月", other: "其他" };
  const typeColors: Record<string, string> = { public_holiday: "bg-red-100 text-red-700", festival: "bg-orange-100 text-orange-700", promotion: "bg-[#0071e3] text-white", ramadan: "bg-green-100 text-green-700", other: "bg-gray-100 text-gray-700" };

  return (
    <div className="space-y-3">
      <div className="bg-[#0071e3]/15 rounded-2xl p-3 text-xs text-[#1d1d1f] mb-3">在这里录入节假日信息，AI 修正时会根据节日类型、节前节后影响等因素自动判断营业额系数。</div>
      <div className="grid grid-cols-5 gap-2 items-end">
        <div><label className="text-xs text-[#86868b]">日期</label><input type="date" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" /></div>
        <div><label className="text-xs text-[#86868b]">名称</label><input value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="如: Hari Raya Aidilfitri" /></div>
        <div><label className="text-xs text-[#86868b]">类型</label><select value={newHolidayType} onChange={(e) => setNewHolidayType(e.target.value as Holiday["type"])} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200">
          <option value="public_holiday">法定公假</option><option value="festival">重要节日</option><option value="promotion">促销活动</option><option value="ramadan">斋月</option><option value="other">其他</option>
        </select></div>
        <div><label className="text-xs text-[#86868b]">备注</label><input value={newHolidayNote} onChange={(e) => setNewHolidayNote(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="可选" /></div>
        <button onClick={handleAddHoliday} disabled={rulesSaving || !newHolidayDate || !newHolidayName} className="bg-[#0071e3] text-white px-4 py-1.5 rounded-xl text-sm hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">添加</button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50/50 sticky top-0"><tr>
            <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">日期</th>
            <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">名称</th>
            <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">类型</th>
            <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">备注</th>
            <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">操作</th>
          </tr></thead>
          <tbody>
            {holidaysList.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-[#86868b] text-sm">暂无节假日数据，请添加</td></tr>
            ) : holidaysList.map((h) => (
              <tr key={h.id} className="hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50">
                <td className="px-3 py-1.5 text-xs font-mono">{h.date}</td>
                <td className="px-3 py-1.5 text-xs font-medium">{h.name}</td>
                <td className="px-3 py-1.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${typeColors[h.type] || ""}`}>{typeLabels[h.type] || h.type}</span></td>
                <td className="px-3 py-1.5 text-xs text-[#86868b]">{h.note}</td>
                <td className="px-3 py-1.5 text-center"><button onClick={() => h.id && handleDeleteHoliday(h.id)} className="text-red-400 text-xs hover:text-red-600 transition-colors duration-200">删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rulesSaving && <p className="text-sm text-[#0071e3] font-medium">保存中...</p>}
    </div>
  );
}

function ProductConfigTab() {
  const { showToast } = useToastContext();
  const [configs, setConfigs] = useState<Array<{ product_name: string; pack_multiple: number; unit_type: string; display_full_quantity: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ packMultiple: 1, unitType: "batch", displayFullQty: 0 });

  useEffect(() => {
    import("@/app/(forecast)/actions").then(({ getProductConfigs }) => {
      getProductConfigs().then((data) => { setConfigs(data); setLoading(false); }).catch(() => setLoading(false));
    });
  }, []);

  const saveEdit = async (productName: string) => {
    setSaving(productName);
    const { updateProductConfig, getProductConfigs } = await import("@/app/(forecast)/actions");
    await updateProductConfig(productName, editValues.packMultiple, editValues.unitType, editValues.displayFullQty);
    const updated = await getProductConfigs();
    setConfigs(updated);
    setEditingProduct(null);
    setSaving(null);
    showToast("已保存", "success");
  };

  const startEdit = (c: typeof configs[0]) => {
    setEditingProduct(c.product_name);
    setEditValues({ packMultiple: c.pack_multiple, unitType: c.unit_type, displayFullQty: c.display_full_quantity });
  };

  if (loading) return <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8"><p className="text-sm text-[#86868b]">加载中...</p></div>;

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f]">产品属性配置</h2>
          <p className="text-sm text-[#86868b] mt-1">配置 Resto API 不提供的生产属性：出货倍数、单位类型、满柜陈列数量。修改后自动同步到排产计算。</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50/50">
            <tr>
              <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">品名</th>
              <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">出货倍数</th>
              <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">单位类型</th>
              <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">满柜数量</th>
              <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">操作</th>
            </tr>
          </thead>
          <tbody>
            {configs.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-[#86868b] text-sm">暂无产品数据，请先同步 Resto 产品</td></tr>
            ) : configs.map((c) => (
              <tr key={c.product_name} className="hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50">
                <td className="px-3 py-1.5 font-medium text-xs">{c.product_name}</td>
                {editingProduct === c.product_name ? (
                  <>
                    <td className="px-2 py-1 text-center">
                      <input type="number" value={editValues.packMultiple} onChange={(e) => setEditValues({ ...editValues, packMultiple: Number(e.target.value) || 1 })} min={1} className="w-16 border-0 bg-gray-50 rounded-lg px-2 py-1 text-center text-xs focus:ring-2 focus:ring-[#0071e3] focus:outline-none" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <select value={editValues.unitType} onChange={(e) => setEditValues({ ...editValues, unitType: e.target.value })} className="w-20 border-0 bg-gray-50 rounded-lg px-1 py-1 text-center text-xs focus:ring-2 focus:ring-[#0071e3] focus:outline-none">
                        <option value="batch">整批</option>
                        <option value="individual">按个</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input type="number" value={editValues.displayFullQty} onChange={(e) => setEditValues({ ...editValues, displayFullQty: Number(e.target.value) || 0 })} min={0} className="w-16 border-0 bg-gray-50 rounded-lg px-2 py-1 text-center text-xs focus:ring-2 focus:ring-[#0071e3] focus:outline-none" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => saveEdit(c.product_name)} disabled={saving === c.product_name} className="text-[#0071e3] text-xs font-medium hover:text-[#005bb5] mr-2">保存</button>
                      <button onClick={() => setEditingProduct(null)} className="text-[#86868b] text-xs hover:text-[#1d1d1f]">取消</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-1.5 text-center text-xs">{c.pack_multiple}</td>
                    <td className="px-3 py-1.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${c.unit_type === "batch" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>{c.unit_type === "batch" ? "整批" : "按个"}</span></td>
                    <td className="px-3 py-1.5 text-center text-xs">{c.display_full_quantity || "-"}</td>
                    <td className="px-3 py-1.5 text-center"><button onClick={() => startEdit(c)} className="text-[#0071e3] text-xs hover:text-[#005bb5]">编辑</button></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}