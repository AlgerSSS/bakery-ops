"use server";

import {
  getBusinessRulesFromDB,
  getPlanningRulesFromDB,
  getProducts,
  getStrategies,
  getSalesBaselines,
  getFixedShipmentSchedules,
  updateFixedShipmentSchedule,
  deleteFixedShipmentSchedule,
  getProductAliases,
  updateProductAlias,
  deleteProductAlias,
  updateBusinessRule,
  getProductConfigs,
  updateProductConfig,
} from "@/modules/data/repositories/forecast.repository";
import {
  generateFullForecast,
  generateMonthlyTargetsWithCustomCoefficients,
  generateDailyTargets,
  generateProductSuggestions,
  generateTimeSlotSuggestions,
} from "@/modules/domain/forecast/forecast.service";

export {
  getBusinessRulesFromDB,
  getPlanningRulesFromDB,
  getProducts,
  getStrategies,
  getSalesBaselines,
  getFixedShipmentSchedules,
  updateFixedShipmentSchedule,
  deleteFixedShipmentSchedule,
  getProductAliases,
  updateProductAlias,
  deleteProductAlias,
  updateBusinessRule,
  getProductConfigs,
  updateProductConfig,
  generateFullForecast,
  generateMonthlyTargetsWithCustomCoefficients,
  generateDailyTargets,
  generateProductSuggestions,
  generateTimeSlotSuggestions,
};
