"use client";

import type { TimeSlotSuggestion, ProductSuggestion, TimeslotSalesRecord } from "@/modules/domain/forecast/types";
import { ALL_SLOTS } from "@/ui/constants";

export function TimeSlotTable({
  suggestions,
  productSuggestions,
  fixedSchedule,
  timeslotSalesRecords,
}: {
  suggestions: TimeSlotSuggestion[];
  productSuggestions: ProductSuggestion[];
  fixedSchedule: Record<string, string[]>;
  timeslotSalesRecords: TimeslotSalesRecord[];
}) {
  const productNames = [...new Set(productSuggestions.map((p) => p.productName))];
  const slotMap = new Map<string, Map<string, TimeSlotSuggestion>>();
  for (const s of suggestions) {
    if (!slotMap.has(s.productName)) slotMap.set(s.productName, new Map());
    slotMap.get(s.productName)!.set(s.timeSlot, s);
  }

  // Build price lookup
  const priceMap = new Map<string, number>();
  for (const p of productSuggestions) priceMap.set(p.productName, p.price);

  // Estimated sales per slot
  const estimatedSalesPerSlot = new Map<string, number>();
  let estimatedSalesTotal = 0;
  for (const slot of ALL_SLOTS) {
    if (slot < "12:00") { estimatedSalesPerSlot.set(slot, 0); continue; }
    const slotAmount = timeslotSalesRecords
      .filter((r) => r.timeSlot === slot)
      .reduce((sum, r) => sum + r.avgQuantity * (priceMap.get(r.productName) ?? 0), 0);
    estimatedSalesPerSlot.set(slot, Math.round(slotAmount));
    estimatedSalesTotal += Math.round(slotAmount);
  }

  // Shipment per slot
  const shipmentPerSlot = new Map<string, number>();
  for (const slot of ALL_SLOTS) {
    shipmentPerSlot.set(slot, suggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0));
  }
  const shipmentTotal = suggestions.reduce((s, item) => s + item.amount, 0);

  return (
    <table className="min-w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50/50">
          <th className="px-2 py-2 text-left sticky left-0 bg-gray-50/50 min-w-[140px] text-[#86868b] font-medium text-xs border-b border-gray-100">品名</th>
          <th className="px-2 py-2 text-right border-b border-gray-100 font-bold text-[#86868b] text-xs">总数</th>
          <th className="px-2 py-2 text-right border-b border-gray-100 font-bold text-[#86868b] text-xs">金额</th>
          {ALL_SLOTS.map((slot) => (
            <th key={slot} className="px-2 py-2 text-center border-b border-gray-100 min-w-[50px] text-[#86868b] font-medium text-xs">{slot.replace(":00", "点")}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {productNames.map((name) => {
          const schedule = fixedSchedule[name] || [];
          const productSlots = suggestions.filter((s) => s.productName === name);
          const totalQty = productSlots.reduce((sum, s) => sum + s.quantity, 0);
          const totalAmount = productSlots.reduce((sum, s) => sum + s.amount, 0);
          return (
            <tr key={name} className="hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50">
              <td className="px-2 py-1.5 font-medium sticky left-0 bg-white text-[11px] whitespace-nowrap">{name}</td>
              <td className="px-2 py-1.5 text-right font-semibold">{totalQty}</td>
              <td className="px-2 py-1.5 text-right text-[#86868b]">{totalAmount.toLocaleString()}</td>
              {ALL_SLOTS.map((slot) => {
                const isFixedSlot = schedule.includes(slot);
                const data = slotMap.get(name)?.get(slot);
                return (
                  <td key={slot} className={`px-2 py-1.5 text-center ${isFixedSlot ? "bg-[#0071e3]/20 text-[#1d1d1f] font-semibold" : "text-gray-300"}`}>
                    {data && data.quantity > 0 ? data.quantity : isFixedSlot ? "-" : ""}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="bg-[#0071e3]/10 font-semibold border-t-2 border-gray-100">
          <td className="px-2 py-2 sticky left-0 bg-[#0071e3]/10">合计</td>
          <td className="px-2 py-2 text-right">{suggestions.reduce((s, item) => s + item.quantity, 0).toLocaleString()}</td>
          <td className="px-2 py-2 text-right">{suggestions.reduce((s, item) => s + item.amount, 0).toLocaleString()}</td>
          {ALL_SLOTS.map((slot) => {
            const total = suggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0);
            return (<td key={slot} className="px-2 py-2 text-center">{total > 0 ? total.toLocaleString() : ""}</td>);
          })}
        </tr>
        <tr className="bg-blue-50/50 font-medium border-t border-gray-100">
          <td className="px-2 py-2 sticky left-0 bg-blue-50/50 text-blue-700">预计销售</td>
          <td className="px-2 py-2 text-right"></td>
          <td className="px-2 py-2 text-right text-blue-700">{estimatedSalesTotal > 0 ? estimatedSalesTotal.toLocaleString() : ""}</td>
          {ALL_SLOTS.map((slot) => {
            const val = estimatedSalesPerSlot.get(slot) || 0;
            return (<td key={slot} className="px-2 py-2 text-center text-blue-700">{val > 0 ? val.toLocaleString() : ""}</td>);
          })}
        </tr>
        <tr className="bg-gray-50/30 font-medium border-t border-gray-100">
          <td className="px-2 py-2 sticky left-0 bg-gray-50/30">预计剩余</td>
          <td className="px-2 py-2 text-right"></td>
          <td className="px-2 py-2 text-right">
            {(() => { const diff = shipmentTotal - estimatedSalesTotal; return <span className={diff < 0 ? "text-red-500" : "text-green-600"}>{diff.toLocaleString()}</span>; })()}
          </td>
          {(() => {
            let cumulativeShipment = 0;
            let cumulativeSales = 0;
            return ALL_SLOTS.map((slot) => {
              cumulativeShipment += shipmentPerSlot.get(slot) || 0;
              cumulativeSales += estimatedSalesPerSlot.get(slot) || 0;
              if (cumulativeShipment === 0 && cumulativeSales === 0) return <td key={slot} className="px-2 py-2 text-center"></td>;
              const diff = cumulativeShipment - cumulativeSales;
              return (<td key={slot} className="px-2 py-2 text-center"><span className={diff < 0 ? "text-red-500" : "text-green-600"}>{diff.toLocaleString()}</span></td>);
            });
          })()}
        </tr>
      </tfoot>
    </table>
  );
}
